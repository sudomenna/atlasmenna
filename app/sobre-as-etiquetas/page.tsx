/**
 * app/sobre-as-etiquetas/page.tsx — "Como classificamos os candidatos": a
 * metodologia das etiquetas editoriais (spec 025, RF-252; constituição 1.6
 * § 8 — obrigatória enquanto qualquer etiqueta for exibida, e toda superfície
 * com etiqueta linka para cá pelo `<EtiquetasAviso>`).
 *
 * Tudo o que a página AFIRMA sai de uma fonte única, nunca de texto repetido:
 *
 *   - catálogo, rótulos, limiares e o CRITÉRIO de cada categoria →
 *     `lib/etiquetas/catalogo.ts` (`CRITERIOS`). Categoria sem critério diz
 *     "critério em definição — nenhuma etiqueta desta categoria é exibida", e
 *     isso é verdade por construção (`categoriaExibivel`);
 *   - as classificações no ar, com fonte, data e origem → os MESMOS arquivos
 *     que as telas leem (`lerEtiquetas`: Blob ou cópia do build). A página
 *     mostra o RESUMO — quantas por categoria × origem e por cargo, tamanho
 *     do catálogo, nunca do dado —; a lista COMPLETA, linha a linha, com cada
 *     classificação por regra derivada e a medida dela, é o CSV público
 *     `./classificacoes.csv` (mesma fonte, `lib/etiquetas/lista-publica.ts`).
 *     Até 29/09 a página listava as individuais e os padrões linha a linha:
 *     ~2,5 KB por linha, 2,6 MB e 1.039 paradas de Tab no pior caso medido, e
 *     a tabela estourava a coluna de 375 px (auditoria de a11y/perf, A3);
 *   - o que prende as visões do Senado de 2027 antes da apuração (os
 *     senadores com mandato até 2031 sem classificação) → a foto do Senado e
 *     o mesmo resolvedor das telas (B6, 29/09);
 *   - "algumas telas mostram etiquetas" só é dito com alguma chave ligada
 *     (`algumaVisaoLigada`) — com tudo desligado, a página diz que nenhuma
 *     tela mostra ainda;
 *   - a proveniência das regras derivadas (corte, fonte) → `nacional.derivados`;
 *   - a data da foto do Senado → `editorial/senado/mandato-2031.json`;
 *   - o registro de alterações → `historico.json` (Blob ou build). Pode passar
 *     de 2 MB no pior caso (design 024 § 2.3): a página mostra as entradas mais
 *     recentes e aponta para o arquivo inteiro, público.
 *
 * Server Component, zero JavaScript, sem `searchParams` (estática com ISR).
 * Nenhum link abre aba nova.
 */

import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { Footer } from "@/components/layout/Footer";
import {
  ALINHAMENTO_BASE_MIN,
  ALINHAMENTO_CORTE,
  ALINHAMENTO_MIN_VOTOS_DISPUTADAS,
  ALINHAMENTO_OPOSICAO_MAX,
  algumaVisaoLigada,
  CATEGORIAS,
  type CategoriaId,
  CRITERIOS,
  categoriaExibivel,
  categoria as defCategoria,
  PORTAO_MARGEM_PP,
  QUALIFICADOR_VISIVEL,
  rotuloDoValor,
} from "@/lib/etiquetas/catalogo";
import type { EntradaHistorico } from "@/lib/etiquetas/formato";
import { type Etiquetas, lerHistoricoEtiquetas } from "@/lib/etiquetas/leitor";
import { lerClassificacoesPublicadas } from "@/lib/etiquetas/lista-publica";
import {
  type AlvoPublicado,
  contagemDerivada,
  type OrigemPublicada,
  pendenciasSenado2031,
  resumoDasClassificacoes,
} from "@/lib/etiquetas/metodologia";
import { dataDaFoto, MANDATO_2031 } from "@/lib/senado/mandato-2031";

import styles from "./page.module.css";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Como classificamos os candidatos · AtlasMenna",
  description:
    "Os critérios, as fontes e o registro de mudanças das etiquetas editoriais do AtlasMenna — relação com o governo Lula, trajetória no cargo e as demais categorias. Classificação editorial: não é dado do TSE nem resultado do modelo.",
  alternates: { canonical: "/sobre-as-etiquetas" },
};

/** Quantas entradas do registro a página mostra (as mais recentes). */
export const ENTRADAS_DO_REGISTRO_NA_PAGINA = 50;

/** Quantos nomes a página lista por visão presa pelo portão (o resto vira "e mais N"). */
export const PENDENCIAS_POR_VISAO_NA_PAGINA = 10;

/** O repositório público — o mesmo que `/sobre-o-modelo` já cita para os ADRs. */
const REPOSITORIO = "https://github.com/sudomenna/salacofre";
/**
 * O canal de correção (constituição § 2 (h)): as issues do repositório
 * público — abertas a qualquer pessoa com conta no GitHub, e o registro da
 * conversa fica público. Nenhum e-mail inventado.
 */
const CANAL_DE_CORRECAO = `${REPOSITORIO}/issues`;
const HISTORICO_NO_REPOSITORIO = `${REPOSITORIO}/blob/main/lib/data/etiquetas/historico.json`;
/** A lista completa, em planilha (`./classificacoes.csv/route.ts`). */
const CSV_DAS_CLASSIFICACOES = "/sobre-as-etiquetas/classificacoes.csv";

const S = {
  page: {
    background: "var(--surface-page)",
    color: "var(--text-primary)",
    minHeight: "100vh",
    paddingBottom: "calc(var(--space-16) + env(safe-area-inset-bottom))",
  },
  container: { maxWidth: 720, margin: "0 auto", padding: "var(--space-10) var(--space-5) 0" },
  kicker: {
    font: "var(--type-kicker)",
    letterSpacing: "var(--tracking-caps)",
    textTransform: "uppercase",
    color: "var(--accent-text)",
    margin: "0 0 var(--space-3)",
  },
  title: { font: "var(--type-headline)", margin: "0 0 var(--space-4)", textWrap: "pretty" },
  deck: {
    font: "var(--type-deck)",
    fontSize: "var(--text-lg)",
    lineHeight: "var(--leading-normal)",
    color: "var(--text-secondary)",
    margin: "0 0 var(--space-8)",
  },
  section: {
    marginTop: "var(--space-10)",
    paddingTop: "var(--space-6)",
    borderTop: "var(--rule-double)",
  },
  h2: { font: "var(--type-title)", margin: "0 0 var(--space-4)", textWrap: "pretty" },
  h3: {
    font: "var(--type-title)",
    fontSize: "var(--text-lg)",
    margin: "var(--space-6) 0 var(--space-2)",
  },
  body: {
    font: "var(--type-body)",
    lineHeight: "var(--leading-relaxed)",
    color: "var(--text-primary)",
    margin: "0 0 var(--space-3)",
  },
  small: {
    font: "var(--type-body-sm)",
    color: "var(--text-secondary)",
    margin: "0 0 var(--space-2)",
  },
} satisfies Record<string, CSSProperties>;

function dataBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : iso;
}

const ROTULO_ALVO: Record<number | string, string> = {
  3: "Governador",
  5: "Senador",
  6: "Deputado Federal",
  senado2031: "Senadores com mandato até 2031",
};

/** Cabeçalho das colunas do resumo, na ordem da seção 3. */
const COLUNAS_ORIGEM: ReadonlyArray<[OrigemPublicada, string]> = [
  ["individual", "Individuais"],
  ["derivado", "Regra derivada"],
  ["partido", "Padrão do partido"],
];

/** O alvo de cada contagem do resumo "por cargo", na ordem da página. */
const ROTULO_ALVO_RESUMO: ReadonlyArray<[AlvoPublicado, string]> = [
  ["governador", "Governador"],
  ["senador", "Senador"],
  ["senado2031", "senadores com mandato até 2031"],
  ["deputado", "Deputado Federal"],
  ["padrao", "padrões de partido ou federação"],
];

const numero = (n: number) => n.toLocaleString("pt-BR");

/** As visões do Senado de 2027 cujo portão tem parte conhecida antes da apuração. */
const VISOES_SENADO_2031 = [
  { visao: "v1", categoria: "relacao_governo", rotulo: "Senado de 2027 por bloco" },
  {
    visao: "v2",
    categoria: "impeachment_stf",
    rotulo: "Impeachment de ministros do STF no Senado de 2027",
  },
] as const;

interface PendenciaNaPagina {
  rotulo: string;
  nomes: string[];
  total: number;
  fotoIndisponivel: boolean;
}

/**
 * Das visões do Senado LIGADAS e com critério, quem com mandato até 2031 ainda
 * não tem classificação (B6, 29/09). Limitado a
 * {@link PENDENCIAS_POR_VISAO_NA_PAGINA} nomes por visão.
 */
function pendenciasDasVisoesDoSenado(etiquetas: Etiquetas): PendenciaNaPagina[] {
  const out: PendenciaNaPagina[] = [];
  for (const v of VISOES_SENADO_2031) {
    if (!etiquetas.viewLigada(v.visao) || !categoriaExibivel(v.categoria)) continue;
    if (!MANDATO_2031.ok || !etiquetas.senado2031.disponivel) {
      out.push({ rotulo: v.rotulo, nomes: [], total: 0, fotoIndisponivel: true });
      continue;
    }
    const senadores = new Map(MANDATO_2031.mandato.senadores.map((x) => [x.codigo, x]));
    const faltam = pendenciasSenado2031(
      [...senadores.keys()],
      (cod) => etiquetas.senador2031(cod, 1)[v.categoria]?.estado === "classificado",
    );
    if (faltam.length === 0) continue;
    out.push({
      rotulo: v.rotulo,
      nomes: faltam.slice(0, PENDENCIAS_POR_VISAO_NA_PAGINA).map((f) => {
        const x = senadores.get(f.codigo);
        return x ? `${x.nome_parlamentar} (${x.partido}, ${x.uf})` : f.chave;
      }),
      total: faltam.length,
      fotoIndisponivel: false,
    });
  }
  return out;
}

function Secao({
  id,
  n,
  titulo,
  children,
}: {
  id: string;
  n: number;
  titulo: string;
  children: ReactNode;
}) {
  return (
    <section style={S.section} aria-labelledby={id}>
      <p style={S.kicker}>{n}</p>
      <h2 id={id} style={S.h2}>
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function descreverEntrada(e: EntradaHistorico): string {
  const cat =
    e.categoria && (CATEGORIAS as readonly { id: string }[]).some((c) => c.id === e.categoria)
      ? defCategoria(e.categoria as CategoriaId).rotulo
      : e.categoria;
  if (e.resumo) return `${cat} — regra derivada (${e.chave.replace("derivado:", "")}): ${e.resumo}`;
  const rotulo = (v: string | null) =>
    v === null ? "sem classificação" : (rotuloDoValor(e.categoria, v) ?? "sem classificação");
  const de = rotulo(e.de);
  const para = rotulo(e.para);
  return `${e.chave} · ${cat}${e.turno ? ` (${e.turno}º turno)` : ""}: ${de} → ${para}`;
}

export default async function SobreAsEtiquetasPage() {
  const {
    etiquetas,
    ufs,
    porLinha: exibiveis,
    derivadas,
    aguardandoCriterio,
  } = await lerClassificacoesPublicadas();
  const nacional = etiquetas.nacional;
  const algumaLigada = algumaVisaoLigada(etiquetas.publicar);
  const resumo = resumoDasClassificacoes(exibiveis, derivadas);
  const pendencias = pendenciasDasVisoesDoSenado(etiquetas);
  const derivados = contagemDerivada(nacional, ufs);
  const historico = await lerHistoricoEtiquetas();
  const recentes = [...historico.arquivo.entradas]
    .reverse()
    .slice(0, ENTRADAS_DO_REGISTRO_NA_PAGINA);
  const fotoSenado = MANDATO_2031.ok
    ? dataDaFoto(MANDATO_2031.mandato)
    : dataBr(nacional.senado2031.foto);
  const d = nacional.derivados;

  return (
    <main style={S.page}>
      <article style={S.container}>
        <p style={S.kicker}>Metodologia</p>
        <h1 style={S.title}>Como classificamos os candidatos</h1>
        <p style={S.deck} data-testid="etiquetas-deck">
          {algumaLigada
            ? 'Algumas telas do AtlasMenna mostram, ao lado dos candidatos, etiquetas como "Base do governo" ou "Tenta a reeleição".'
            : 'Nenhuma tela do AtlasMenna mostra etiquetas editoriais ainda. Quando mostrarem, serão rótulos como "Base do governo" ou "Tenta a reeleição", ao lado dos candidatos.'}{" "}
          São classificação editorial nossa, com fonte e data em cada uma — não são dado do TSE nem
          resultado do modelo. Esta página diz o critério de cada etiqueta, de onde ela vem, quando
          uma visão aparece, o que já está no ar e o que mudou.
        </p>

        <Secao id="sec-o-que-e" n={1} titulo="O que uma etiqueta é, e o que ela nunca faz">
          <p style={S.body}>
            Uma etiqueta é um rótulo de texto, com borda tracejada e sem cor de partido. Ela nunca
            muda a ordem dos candidatos (que segue o voto), nunca entra na projeção e nunca é
            gravada junto do resultado da apuração. Uma classificação só vai ao ar depois de
            revisada, com fonte e data; enquanto não está revisada, o candidato simplesmente fica
            sem etiqueta.
          </p>
          <p style={S.body} data-testid="etiquetas-revisao-derivada">
            Nas regras derivadas (seção 5), que classificam milhares de candidaturas de uma vez, a
            revisão é do <strong>arquivo inteiro</strong>: o arquivo de dados de onde a regra sai só
            é usado depois que o responsável editorial o aprova, com data e nome. Sem essa
            aprovação, a regra não classifica ninguém; e um arquivo refeito com dados novos volta a
            precisar de aprovação.
          </p>
          <p style={S.body}>
            As posições "Base do governo", "Independente" e "Oposição" descrevem a relação com o{" "}
            <strong>governo Lula</strong>, não posição ideológica. Nos gráficos por bloco, a ordem
            da esquerda para a direita (Base, Independentes, Oposição) é fixa e segue essa relação.
          </p>
        </Secao>

        <Secao id="sec-criterios" n={2} titulo="As categorias e o critério de cada uma">
          <p style={S.body}>
            O catálogo é fechado: nenhuma etiqueta existe fora dele. Categoria cujo critério ainda
            não foi publicado não tem etiqueta nenhuma no ar.
          </p>
          {CATEGORIAS.map((c) => {
            const criterio = CRITERIOS[c.id];
            return (
              <div key={c.id} data-testid="etiquetas-categoria" data-categoria={c.id}>
                <h3 style={S.h3}>{QUALIFICADOR_VISIVEL[c.id] ?? c.rotulo}</h3>
                <p style={S.small}>
                  Valores:{" "}
                  {c.valores
                    .filter((v) => v.rotulo !== null)
                    .map((v) => v.rotulo)
                    .join(" · ")}
                  . Vale para: {c.aplicaA.map((a) => ROTULO_ALVO[a]).join(", ")}.
                  {c.porTurno ? " Classificada separadamente em cada turno." : ""}
                  {c.herdaDoPartido
                    ? " Sem classificação individual, vale o padrão do partido (ou da federação)."
                    : " Só por classificação individual ou regra medida — nunca pelo partido."}
                </p>
                {criterio ? (
                  <p style={S.body} data-testid="etiquetas-criterio">
                    {criterio}
                  </p>
                ) : (
                  <p style={S.body} data-testid="etiquetas-criterio-em-definicao">
                    <strong>
                      Critério em definição — nenhuma etiqueta desta categoria é exibida.
                    </strong>
                  </p>
                )}
              </div>
            );
          })}
        </Secao>

        <Secao id="sec-fontes" n={3} titulo="De onde vem cada classificação">
          <p style={S.body}>
            Toda classificação tem uma fonte (endereço e descrição), a data da fonte e a data da
            revisão — na regra derivada, a data em que o arquivo inteiro foi aprovado. Ela chega à
            tela por um de três caminhos, e a lista da seção 6 diz qual:
          </p>
          <ul style={{ ...S.body, paddingLeft: "var(--space-5)" }}>
            <li>
              <strong>classificação individual</strong> — uma linha só para aquela pessoa, com fonte
              própria. Vale sobre as demais;
            </li>
            <li>
              <strong>regra derivada</strong> — medida em dado público (votações e mandatos,
              abaixo), a mesma regra para todos;
            </li>
            <li>
              <strong>padrão do partido ou da federação</strong> — quem não tem nenhuma das duas
              herda o do partido. Isso produz erro individual conhecido: quem diverge do partido
              carrega o rótulo dele até ganhar uma linha própria.
            </li>
          </ul>
        </Secao>

        <Secao id="sec-portao" n={4} titulo="Quando uma visão agregada aparece">
          <p style={S.body}>
            Os gráficos que somam etiquetas — o Senado e a Câmara de 2027 por bloco, o placar do
            impeachment de ministros do STF, o mapa dos palanques, a renovação — só aparecem quando{" "}
            <strong>todos os candidatos com chance</strong> estão classificados. Com chance quer
            dizer: as posições que elegem (as duas vagas do Senado em cada estado; os dois primeiros
            para governador) e quem está a até {PORTAO_MARGEM_PP} pontos percentuais da última
            delas, tanto na contagem parcial quanto na projeção. No Senado entram também os 27
            senadores que seguem até 2031; na Câmara, todo partido ou federação com cadeira.
            Candidatura anulada fica de fora. Se falta um, a visão não aparece — ela não é mostrada
            pela metade.
          </p>
          {pendencias.length > 0 ? (
            <div data-testid="etiquetas-pendencias">
              <p style={S.body}>
                <strong>O que falta agora.</strong> Visões ligadas que não aparecem porque alguém
                com mandato até 2031 ainda não tem classificação (os candidatos com chance só se
                conhecem com a apuração):
              </p>
              <ul className={styles.lista}>
                {pendencias.map((p) => (
                  <li key={p.rotulo} data-testid="etiquetas-pendencia">
                    <strong>{p.rotulo}</strong>:{" "}
                    {p.fotoIndisponivel
                      ? "a foto do Senado não está disponível, e sem ela a visão não aparece."
                      : `${p.nomes.join("; ")}${p.total > p.nomes.length ? ` e mais ${numero(p.total - p.nomes.length)}` : ""}.`}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Secao>

        <Secao id="sec-metodo" n={5} titulo="O alinhamento e a trajetória, medidos">
          <p style={S.body}>
            <strong>Relação com o governo, para quem tem mandato.</strong> A taxa de votos iguais à
            orientação do governo nas votações nominais disputadas — aquelas em que a Oposição
            orientou o contrário do governo ou orientou obstrução. Com ao menos{" "}
            {ALINHAMENTO_MIN_VOTOS_DISPUTADAS} votos nessas votações: {ALINHAMENTO_BASE_MIN}% ou
            mais é Base do governo; {ALINHAMENTO_OPOSICAO_MAX}% ou menos, Oposição; entre os dois,
            Independente. Os limiares são escolha editorial, não resultado: um parlamentar a um
            ponto do corte muda de bloco.
          </p>
          <p style={S.small} data-testid="etiquetas-corte-camara">
            Câmara: dados até {dataBr(ALINHAMENTO_CORTE)}
            {d.alinhamento_camara ? (
              <>
                {" "}
                —{" "}
                <a href={d.alinhamento_camara.fonte_url}>{d.alinhamento_camara.fonte_descricao}</a>,
                aprovado em {dataBr(d.alinhamento_camara.revisado_em)}.{" "}
                {derivados.camara.relacao_governo} candidaturas a Deputado Federal classificadas
                pela regra.
              </>
            ) : (
              ". O dado da Câmara ainda não está no ar."
            )}
          </p>
          <p style={S.small} data-testid="etiquetas-corte-senado">
            {d.alinhamento_senado ? (
              <>
                Senado: dados até {dataBr(d.alinhamento_senado.data)} —{" "}
                <a href={d.alinhamento_senado.fonte_url}>{d.alinhamento_senado.fonte_descricao}</a>,
                aprovado em {dataBr(d.alinhamento_senado.revisado_em)}.{" "}
                {derivados.senado.relacao_governo} senadores e candidaturas ao Senado classificados
                pela regra.
              </>
            ) : (
              "Senado: o dado de votações do Senado ainda não está no ar."
            )}
          </p>
          <p style={S.body}>
            <strong>Trajetória no cargo.</strong> Pelos registros de mandato da Câmara e do Senado:
            quem exerce o mandato hoje, ou exerceu na legislatura atual, tenta a reeleição; quem
            exerceu só antes volta ao cargo; quem nunca exerceu é estreante. Candidatura que o
            cruzamento não encontra fica sem etiqueta — ausência nunca vira "estreante".
            {d.trajetoria_camara
              ? ` Câmara: ${derivados.camara.trajetoria_cargo} candidaturas classificadas (arquivo aprovado em ${dataBr(d.trajetoria_camara.revisado_em)}).`
              : " Câmara: ainda não está no ar."}
            {d.trajetoria_senado
              ? ` Senado: ${derivados.senado.trajetoria_cargo} candidaturas classificadas (arquivo aprovado em ${dataBr(d.trajetoria_senado.revisado_em)}).`
              : " Senado: ainda não está no ar."}
          </p>
          <p style={S.small} data-testid="etiquetas-foto-senado">
            Os 27 senadores com mandato até 2031 e o partido de cada um: foto do Senado Federal
            (Dados Abertos) em {fotoSenado}. Partido é o de quem ocupa a cadeira hoje, suplente
            incluído.
          </p>
        </Secao>

        <Secao id="sec-publicadas" n={6} titulo="Todas as classificações no ar">
          <p style={S.body} data-testid="etiquetas-lista-completa">
            A lista completa — cada classificação no ar, uma por linha, inclusive as por regra
            derivada ({numero(derivadas.length)} agora), com origem, fonte, data da fonte, data da
            revisão e, na relação com o governo medida, os votos e a taxa — está em{" "}
            <a href={CSV_DAS_CLASSIFICACOES}>classificacoes.csv</a> (planilha, atualizada junto com
            esta página). Abaixo, quantas estão no ar, por categoria e origem e por cargo.
          </p>
          {resumo.total === 0 ? (
            <p style={S.body} data-testid="etiquetas-nenhuma-publicada">
              Nenhuma classificação está no ar agora.
            </p>
          ) : (
            <>
              <table className={styles.resumo} data-testid="etiquetas-resumo">
                <caption className={styles.legendaTabela}>
                  {`${numero(resumo.total)} classificações no ar, por categoria e origem`}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Categoria</th>
                    {COLUNAS_ORIGEM.map(([o, rotulo]) => (
                      <th key={o} scope="col" className={styles.num}>
                        {rotulo}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resumo.porCategoria.map((c) => (
                    <tr key={c.categoria}>
                      <th scope="row">
                        {QUALIFICADOR_VISIVEL[c.categoria] ?? defCategoria(c.categoria).rotulo}
                      </th>
                      {COLUNAS_ORIGEM.map(([o]) => (
                        <td key={o} className={styles.num}>
                          {numero(c[o])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={S.small} data-testid="etiquetas-resumo-cargo">
                Por cargo:{" "}
                {ROTULO_ALVO_RESUMO.filter(([a]) => resumo.porAlvo[a] > 0)
                  .map(([a, rotulo]) => `${rotulo}, ${numero(resumo.porAlvo[a])}`)
                  .join(" · ")}
                .
              </p>
            </>
          )}
          {Object.keys(aguardandoCriterio).length > 0 ? (
            <p style={S.small} data-testid="etiquetas-aguardando-criterio">
              Revisadas mas fora do ar, à espera do critério publicado:{" "}
              {(Object.entries(aguardandoCriterio) as [CategoriaId, number][])
                .map(([c, n]) => `${defCategoria(c).rotulo} (${n})`)
                .join(", ")}
              .
            </p>
          ) : null}
        </Secao>

        <Secao id="sec-registro" n={7} titulo="Registro de alterações">
          <p style={S.body}>
            Toda mudança numa classificação no ar entra neste registro, com o quê, de → para, a
            fonte e quando. Entradas antigas nunca são reescritas.{" "}
            {historico.arquivo.entradas.length > recentes.length
              ? `Abaixo, as ${recentes.length} mais recentes de ${historico.arquivo.entradas.length}; o registro inteiro está em `
              : "O registro inteiro também está em "}
            <a href={historico.url ?? HISTORICO_NO_REPOSITORIO}>
              {historico.url ? "arquivo público" : "no repositório público do projeto"}
            </a>
            .
          </p>
          {recentes.length === 0 ? (
            <p style={S.small} data-testid="etiquetas-registro-vazio">
              Nenhuma alteração registrada ainda.
            </p>
          ) : (
            <ol
              reversed
              style={{ ...S.small, paddingLeft: "var(--space-5)" }}
              data-testid="etiquetas-registro"
            >
              {recentes.map((e) => (
                <li key={`${e.versao}|${e.chave}|${e.categoria}|${e.turno ?? ""}`}>
                  {dataBr(e.em)} — {descreverEntrada(e)}
                  {e.fonte_url ? (
                    <>
                      {" "}
                      (<a href={e.fonte_url}>fonte</a>
                      {e.data ? `, ${dataBr(e.data)}` : ""})
                    </>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </Secao>

        <Secao id="sec-limites" n={8} titulo="O que as etiquetas não dizem">
          <ul style={{ ...S.body, paddingLeft: "var(--space-5)" }}>
            <li>
              Não dizem como alguém vai votar. Relação com o governo mede o passado recente; a
              posição sobre impeachment de ministros do STF é a declarada em público, não um voto.
            </li>
            <li>
              Em 2027 o governo pode ser outro: a classificação é a relação com o governo Lula.
            </li>
            <li>
              O padrão do partido é uma aproximação. Durante a apuração, a Câmara de 2027 é mostrada
              pelo padrão de cada partido ou federação, não deputado a deputado.
            </li>
            <li>
              A foto do Senado envelhece: troca de partido ou de suplente depois da data dela não
              aparece até a foto ser refeita.
            </li>
            <li>
              Uma visão pode não aparecer na noite da eleição por falta de classificação — é o
              portão da seção 4 funcionando, não um erro.
            </li>
          </ul>
        </Secao>

        <Secao id="sec-correcao" n={9} titulo="Como pedir uma correção">
          <p style={S.body} data-testid="etiquetas-canal-correcao">
            Se uma classificação estiver errada, diga qual, por quê e com que fonte{" "}
            <a href={CANAL_DE_CORRECAO}>abrindo uma issue no repositório público do projeto</a> (é
            preciso uma conta gratuita no GitHub; o pedido e a resposta ficam públicos). Uma
            correção aceita vai ao ar em minutos, sem esperar nova versão do site, e entra no
            registro acima com a data. Pedidos sobre a projeção seguem pelo mesmo canal — ver{" "}
            <Link href="/sobre-o-modelo">Sobre o modelo</Link>.
          </p>
        </Secao>
      </article>
      <Footer />
    </main>
  );
}
