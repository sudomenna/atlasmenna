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
 *     que as telas leem (`lerEtiquetas`: Blob ou cópia do build);
 *   - a proveniência das regras derivadas (corte, fonte) → `nacional.derivados`;
 *   - a data da foto do Senado → `editorial/senado/mandato-2031.json`;
 *   - o registro de alterações → `historico.json` (Blob ou build). Pode passar
 *     de 2 MB no pior caso (design 024 § 2.3): a página mostra as entradas mais
 *     recentes e aponta para o arquivo inteiro, público.
 *
 * Server Component, zero JavaScript, sem `searchParams` (estática com ISR).
 */

import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { Footer } from "@/components/layout/Footer";
import { type CandidatoIdentidade, readCandidatosUf } from "@/lib/blob/candidatos";
import { cargoToken } from "@/lib/config/cargos";
import {
  ALINHAMENTO_BASE_MIN,
  ALINHAMENTO_CORTE,
  ALINHAMENTO_MIN_VOTOS_DISPUTADAS,
  ALINHAMENTO_OPOSICAO_MAX,
  CATEGORIAS,
  type CategoriaId,
  CRITERIOS,
  categoria as defCategoria,
  PORTAO_MARGEM_PP,
  QUALIFICADOR_VISIVEL,
  rotuloDoValor,
} from "@/lib/etiquetas/catalogo";
import { type ArquivoUf, type EntradaHistorico, UFS } from "@/lib/etiquetas/formato";
import { lerEtiquetas, lerHistoricoEtiquetas } from "@/lib/etiquetas/leitor";
import {
  contagemDerivada,
  type LinhaPublicada,
  linhasPublicadas,
  separarPorCriterio,
} from "@/lib/etiquetas/metodologia";
import { dataDaFoto, MANDATO_2031 } from "@/lib/senado/mandato-2031";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Como classificamos os candidatos · AtlasMenna",
  description:
    "Os critérios, as fontes e o registro de mudanças das etiquetas editoriais do AtlasMenna — relação com o governo Lula, trajetória no cargo e as demais categorias. Classificação editorial: não é dado do TSE nem resultado do modelo.",
  alternates: { canonical: "/sobre-as-etiquetas" },
};

/** Quantas entradas do registro a página mostra (as mais recentes). */
export const ENTRADAS_DO_REGISTRO_NA_PAGINA = 50;

/** O repositório público — o mesmo que `/sobre-o-modelo` já cita para os ADRs. */
const REPOSITORIO = "https://github.com/sudomenna/salacofre";
const HISTORICO_NO_REPOSITORIO = `${REPOSITORIO}/blob/main/lib/data/etiquetas/historico.json`;

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
  table: {
    width: "100%",
    borderCollapse: "collapse",
    font: "var(--type-body-sm)",
    color: "var(--text-primary)",
  },
  th: {
    textAlign: "left",
    padding: "var(--space-1) var(--space-2) var(--space-1) 0",
    verticalAlign: "bottom",
  },
  td: {
    padding: "var(--space-1) var(--space-2) var(--space-1) 0",
    borderTop: "1px solid var(--border-hairline)",
    verticalAlign: "top",
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

const ROTULO_ORIGEM: Record<LinhaPublicada["origem"], string> = {
  individual: "classificação individual",
  partido: "padrão do partido ou da federação",
};

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

/** Nome de exibição de quem tem linha individual — pelo cadastro publicado, quando der. */
async function nomesDasLinhas(linhas: readonly LinhaPublicada[]): Promise<Map<string, string>> {
  const nomes = new Map<string, string>();
  if (MANDATO_2031.ok) {
    for (const s of MANDATO_2031.mandato.senadores)
      nomes.set(`senado:${s.codigo}`, s.nome_parlamentar);
  }
  const pedidos = new Map<string, { uf: string; cargo: 3 | 5 | 6 }>();
  for (const l of linhas) {
    if (!l.uf) continue;
    const cargo =
      l.alvo === "governador" ? 3 : l.alvo === "senador" ? 5 : l.alvo === "deputado" ? 6 : null;
    if (cargo) pedidos.set(`${l.uf}:${cargo}`, { uf: l.uf, cargo });
  }
  await Promise.all(
    [...pedidos.values()].map(async ({ uf, cargo }) => {
      try {
        const r = await readCandidatosUf(uf, cargoToken(cargo));
        if (r.status !== "ok") return;
        for (const c of r.slice.candidatos as CandidatoIdentidade[])
          nomes.set(c.sqcand, c.nome_urna);
      } catch {
        // Sem o cadastro, a linha sai com o número da candidatura — nunca some.
      }
    }),
  );
  return nomes;
}

function quem(l: LinhaPublicada, nomes: Map<string, string>): string {
  if (l.alvo === "padrao") {
    const [tipo, sigla] = l.chave.split(/:(.*)/s);
    return `${tipo === "federacao" ? "Padrão da federação" : "Padrão do partido"} ${sigla ?? ""}`;
  }
  const nome = nomes.get(l.chave) ?? `candidatura ${l.chave}`;
  const alvo =
    l.alvo === "governador"
      ? "Governador"
      : l.alvo === "senador"
        ? "Senador"
        : l.alvo === "deputado"
          ? "Deputado Federal"
          : "senador(a) até 2031";
  return `${nome} (${[alvo, l.uf, l.partido].filter(Boolean).join(", ")})`;
}

function textoDaEtiqueta(l: LinhaPublicada): string {
  const q = QUALIFICADOR_VISIVEL[l.categoria];
  const base = q
    ? `${q}: ${l.rotulo.toLocaleLowerCase("pt-BR")}`
    : `${defCategoria(l.categoria).rotulo}: ${l.rotulo}`;
  return l.turno ? `${base} (${l.turno}º turno)` : base;
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
  const etiquetas = await lerEtiquetas();
  const ufs = (await Promise.all(UFS.map((uf) => lerEtiquetas({ uf }))))
    .map((e) => e.arquivoUf)
    .filter((u): u is ArquivoUf => u !== null);
  const nacional = etiquetas.nacional;
  const { exibiveis, aguardandoCriterio } = separarPorCriterio(linhasPublicadas(nacional, ufs));
  const nomes = await nomesDasLinhas(exibiveis);
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
        <p style={S.deck}>
          Algumas telas do AtlasMenna mostram, ao lado dos candidatos, etiquetas como "Base do
          governo" ou "Tenta a reeleição". São classificação editorial nossa, com fonte e data em
          cada uma — não são dado do TSE nem resultado do modelo. Esta página diz o critério de cada
          etiqueta, de onde ela vem, quando uma visão aparece, o que já está no ar e o que mudou.
        </p>

        <Secao id="sec-o-que-e" n={1} titulo="O que uma etiqueta é, e o que ela nunca faz">
          <p style={S.body}>
            Uma etiqueta é um rótulo de texto, com borda tracejada e sem cor de partido. Ela nunca
            muda a ordem dos candidatos (que segue o voto), nunca entra na projeção e nunca é
            gravada junto do resultado da apuração. Uma classificação só vai ao ar depois de
            revisada, com fonte e data; enquanto não está revisada, o candidato simplesmente fica
            sem etiqueta.
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
            revisão. Ela chega à tela por um de três caminhos, e a lista abaixo diz qual:
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
                <a href={d.alinhamento_camara.fonte_url} rel="noopener noreferrer" target="_blank">
                  {d.alinhamento_camara.fonte_descricao}
                </a>
                . {derivados.camara.relacao_governo} candidaturas a Deputado Federal classificadas
                pela regra.
              </>
            ) : (
              ". O dado da Câmara ainda não está publicado."
            )}
          </p>
          <p style={S.small} data-testid="etiquetas-corte-senado">
            {d.alinhamento_senado ? (
              <>
                Senado: dados até {dataBr(d.alinhamento_senado.data)} —{" "}
                <a href={d.alinhamento_senado.fonte_url} rel="noopener noreferrer" target="_blank">
                  {d.alinhamento_senado.fonte_descricao}
                </a>
                . {derivados.senado.relacao_governo} senadores e candidaturas ao Senado
                classificados pela regra.
              </>
            ) : (
              "Senado: o dado de votações do Senado ainda não está publicado."
            )}
          </p>
          <p style={S.body}>
            <strong>Trajetória no cargo.</strong> Pelos registros de mandato da Câmara e do Senado:
            quem exerce o mandato hoje, ou exerceu na legislatura atual, tenta a reeleição; quem
            exerceu só antes volta ao cargo; quem nunca exerceu é estreante. Candidatura que o
            cruzamento não encontra fica sem etiqueta — ausência nunca vira "estreante".
            {d.trajetoria_camara
              ? ` Câmara: ${derivados.camara.trajetoria_cargo} candidaturas classificadas.`
              : ""}
            {d.trajetoria_senado
              ? ` Senado: ${derivados.senado.trajetoria_cargo} candidaturas classificadas.`
              : ""}
          </p>
          <p style={S.small} data-testid="etiquetas-foto-senado">
            Os 27 senadores com mandato até 2031 e o partido de cada um: foto do Senado Federal
            (Dados Abertos) em {fotoSenado}. Partido é o de quem ocupa a cadeira hoje, suplente
            incluído.
          </p>
        </Secao>

        <Secao id="sec-publicadas" n={6} titulo="Todas as classificações no ar">
          {exibiveis.length === 0 ? (
            <p style={S.body} data-testid="etiquetas-nenhuma-publicada">
              Nenhuma classificação está no ar agora.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={S.table} data-testid="etiquetas-publicadas">
                <caption className="sr-only">
                  Classificações editoriais no ar, com origem, fonte e datas
                </caption>
                <thead>
                  <tr>
                    <th scope="col" style={S.th}>
                      Quem
                    </th>
                    <th scope="col" style={S.th}>
                      Etiqueta
                    </th>
                    <th scope="col" style={S.th}>
                      Origem
                    </th>
                    <th scope="col" style={S.th}>
                      Fonte
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {exibiveis.map((l) => (
                    <tr key={`${l.chave}|${l.categoria}|${l.turno ?? ""}`}>
                      <td style={S.td}>{quem(l, nomes)}</td>
                      <td style={S.td}>{textoDaEtiqueta(l)}</td>
                      <td style={S.td}>{ROTULO_ORIGEM[l.origem]}</td>
                      <td style={S.td}>
                        <a href={l.fonte_url} rel="noopener noreferrer" target="_blank">
                          {l.fonte_descricao}
                        </a>
                        , {dataBr(l.data)} · revisada em {dataBr(l.revisado_em)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
          <p style={S.small}>
            As classificações por regra derivada não estão linha a linha aqui — são milhares, e a
            regra é a mesma para todas (seção 5).
          </p>
        </Secao>

        <Secao id="sec-registro" n={7} titulo="Registro de alterações">
          <p style={S.body}>
            Toda mudança numa classificação no ar entra neste registro, com o quê, de → para, a
            fonte e quando. Entradas antigas nunca são reescritas.{" "}
            {historico.arquivo.entradas.length > recentes.length
              ? `Abaixo, as ${recentes.length} mais recentes de ${historico.arquivo.entradas.length}; o registro inteiro está em `
              : "O registro inteiro também está em "}
            <a
              href={historico.url ?? HISTORICO_NO_REPOSITORIO}
              rel="noopener noreferrer"
              target="_blank"
            >
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
                      (
                      <a href={e.fonte_url} rel="noopener noreferrer" target="_blank">
                        fonte
                      </a>
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
          <p style={S.body}>
            Se uma classificação estiver errada, diga qual, por quê e com que fonte pelo{" "}
            <a href={REPOSITORIO} rel="noopener noreferrer" target="_blank">
              repositório público do projeto
            </a>
            . Uma correção aceita vai ao ar em minutos, sem esperar nova versão do site, e entra no
            registro acima com a data. O contato de redação será publicado em{" "}
            <Link href="/sobre-o-modelo">Sobre o modelo</Link>.
          </p>
        </Secao>
      </article>
      <Footer />
    </main>
  );
}
