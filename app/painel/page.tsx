/**
 * app/painel/page.tsx — `/painel`
 *
 * Painel PRIVADO de monitoramento da noite de apuração (ADR-0077): tudo o que
 * o sistema fez — pedidos ao TSE, novidades, erros, bloqueios, coletas,
 * rodadas da projeção, correções — a partir de um **retrato fixo** gerado uma
 * vez do banco (`pnpm painel:retrato`). Não é ao vivo.
 *
 * Três travas, nesta ordem:
 *
 *   1. `proxy.ts` pede a senha (HTTP Basic contra `PAINEL_SENHA`, fail-closed)
 *      para o HTML e para as requisições RSC;
 *   2. esta página confere a MESMA senha de novo, no cabeçalho que recebeu —
 *      se algum dia uma variante de caminho escapar do matcher, a página não
 *      entrega dado nenhum;
 *   3. o retrato vem do Vercel Blob num ENDEREÇO SECRETO (plano B do ADR-0077;
 *      nunca do repositório, que é público), lido só por `lib/painel/ler.ts`,
 *      que nenhum arquivo `"use client"` importa. A URL não aparece nesta
 *      página — nem na mensagem de falha, que mostra só um motivo genérico.
 *      O único componente de cliente (`GraficoPorMinuto`) recebe números por
 *      props.
 *
 * Nada de Postgres aqui (ADR-0001): a página lê só o retrato.
 *
 * O layout raiz (barra do topo e barra de cargos) é herdado de propósito: dá
 * ao dono o caminho de volta para o site, e não lê nenhum dado.
 */

import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { Footer } from "@/components/layout/Footer";
import { corDoCargo, DuracaoDosCiclos, RodadasDaProjecao } from "@/components/painel/Faixas";
import { GraficoPorMinuto, type SerieDoGrafico } from "@/components/painel/GraficoPorMinuto";
import s from "@/components/painel/painel.module.css";
import { SecaoCorrida } from "@/components/painel/SecaoCorrida";
import {
  FiltroDeCiclos,
  TabelaDeCiclos,
  TabelaPorBlocos,
  TabelaRolavel,
  VerEmTabela,
} from "@/components/painel/Tabelas";
import { painelAutorizado } from "@/lib/painel/acesso";
import {
  filtrarCiclos,
  lerFiltroCiclos,
  nomeDoCargo,
  ocorrenciasDaNoite,
} from "@/lib/painel/apresentar";
import {
  degrausPorMinuto,
  escalaBonita,
  fmtNum,
  horaComDia,
  horaCurta,
  minutoNoEixo,
  msDeIso,
} from "@/lib/painel/eixo";
import { lerRetrato } from "@/lib/painel/ler";
import {
  CARGOS_COM_RODADA,
  CARGOS_DO_PAINEL,
  type ChaveCargo,
  type RetratoPainel,
  type SeriePorCargo,
} from "@/lib/painel/tipos";

export const dynamic = "force-dynamic";

const LEGENDA_POR_CARGO =
  "Uma coleta é uma passada pedindo ao TSE todos os arquivos de um cargo. A do Deputado Federal é dividida em 6 partes.";
const LEGENDA_DURACAO =
  "Duração das coletas por cargo (todas as coletas estão na tabela do fim da página)";
const LEGENDA_PARADAS = "Paradas da projeção de mais de 10 minutos";

export const metadata: Metadata = {
  title: "Painel da noite — AtlasMenna",
  robots: { index: false, follow: false },
};

type Busca = Promise<Record<string, string | string[] | undefined>>;

export default async function PainelPage({ searchParams }: { searchParams: Busca }) {
  // Segunda trava (a primeira é o proxy.ts): sem a senha certa no cabeçalho,
  // esta rota não existe.
  const cabecalhos = await headers();
  if (!painelAutorizado(cabecalhos.get("authorization"), process.env.PAINEL_SENHA)) notFound();

  const leitura = await lerRetrato();
  const filtro = lerFiltroCiclos(await searchParams);

  return (
    <main className={s.painel}>
      <header className={s.cabecalho}>
        <p className={s.kicker}>Painel privado · retrato fixo</p>
        <h1 className={s.titulo}>O que o sistema fez na noite da apuração</h1>
        {leitura.status === "ok" ? (
          <Subtitulo retrato={leitura.retrato} />
        ) : (
          <p className={s.subtitulo}>Monitoramento da coleta de dados do TSE e da projeção.</p>
        )}
      </header>
      {leitura.status === "ok" ? (
        <Conteudo retrato={leitura.retrato} filtro={filtro} />
      ) : (
        <section className={s.aviso} aria-live="polite">
          <h2>O retrato ainda não está disponível</h2>
          <p>
            {leitura.status === "ausente"
              ? "Ainda não há retrato publicado para este painel."
              : "O retrato existe, mas não pôde ser lido."}{" "}
            Detalhe técnico: {leitura.motivo}.
          </p>
          <p>
            O retrato é gerado a partir dos registros do banco com{" "}
            <code>pnpm painel:retrato --escrever</code>.
          </p>
        </section>
      )}
      <Footer />
    </main>
  );
}

function Subtitulo({ retrato }: { retrato: RetratoPainel }) {
  const ref = msDeIso(retrato.janela.de);
  const gerado = msDeIso(retrato.geradoEm);
  return (
    <>
      <p className={s.subtitulo}>
        {retrato.turno}º turno. Retrato gerado em {horaComDia(gerado, 0)} a partir dos registros
        guardados no banco; cobre de {horaComDia(ref, 0)} a{" "}
        {horaComDia(msDeIso(retrato.janela.ate), 0)}. Horários de Brasília. Não é ao vivo: para o 2º
        turno, gera-se outro retrato.
      </p>
      <nav aria-label="Seções do painel">
        <ul className={s.indice}>
          <li>
            <a href="#resumo">Resumo</a>
          </li>
          <li>
            <a href="#corrida">Presidente: os dois primeiros</a>
          </li>
          <li>
            <a href="#ocorrencias">Ocorrências</a>
          </li>
          <li>
            <a href="#pedidos">Pedidos ao TSE</a>
          </li>
          <li>
            <a href="#novidades">Novidades</a>
          </li>
          <li>
            <a href="#falhas">Erros e bloqueios</a>
          </li>
          <li>
            <a href="#duracao">Duração das coletas</a>
          </li>
          <li>
            <a href="#projecao">Projeção</a>
          </li>
          <li>
            <a href="#apurado">% apurado</a>
          </li>
          <li>
            <a href="#correcoes">Correções</a>
          </li>
          <li>
            <a href="#parados">Arquivos parados</a>
          </li>
          <li>
            <a href="#coletas">Todas as coletas</a>
          </li>
          <li>
            <a href="#nao-registrado">O que não é registrado</a>
          </li>
        </ul>
      </nav>
    </>
  );
}

function soma(serie: SeriePorCargo): number[] {
  const n = serie["1"].length;
  const out = new Array<number>(n).fill(0);
  for (const cd of CARGOS_DO_PAINEL) {
    const v = serie[String(cd) as ChaveCargo];
    for (let i = 0; i < n; i++) out[i] = (out[i] as number) + (v[i] ?? 0);
  }
  return out;
}

function Conteudo({
  retrato: r,
  filtro,
}: {
  retrato: RetratoPainel;
  filtro: ReturnType<typeof lerFiltroCiclos>;
}) {
  const inicioMs = msDeIso(r.eixo.inicio);
  const minutos = r.eixo.minutos;
  const ref = msDeIso(r.janela.de);

  const seriesDe = (serie: SeriePorCargo): SerieDoGrafico[] =>
    r.cargos.map((c) => ({
      chave: String(c.cd),
      rotulo: c.nome,
      cor: corDoCargo(c.cd),
      valores: serie[String(c.cd) as ChaveCargo],
    }));
  const colunasDe = (serie: SeriePorCargo) =>
    r.cargos.map((c) => ({ rotulo: c.nome, valores: serie[String(c.cd) as ChaveCargo] }));

  const marcas = r.correcoes
    .map((c) => ({
      minuto: minutoNoEixo(msDeIso(c.hora), inicioMs),
      rotulo: `${horaCurta(msDeIso(c.hora))} · ${c.hash} — ${c.titulo.length > 90 ? `${c.titulo.slice(0, 89)}…` : c.titulo}`,
    }))
    .filter((m) => m.minuto >= 0 && m.minuto < minutos);

  // --- totais ---------------------------------------------------------------
  const totalPedidos = r.totais.reduce((a, t) => a + t.pedidos, 0);
  const totalNovidades = r.totais.reduce((a, t) => a + t.novidades, 0);
  const totalColetas = r.totais.reduce((a, t) => a + t.ciclos, 0);
  const totalInterrompidas = r.totais.reduce((a, t) => a + t.interrompidos, 0);
  const totalErros = r.totais.reduce((a, t) => a + t.erros, 0);
  const totalNaoEncontrados = r.totais.reduce((a, t) => a + t.naoEncontrados, 0);
  const bloqMin = r.episodiosDeBloqueio.reduce((a, e) => a + e.minimo, 0);
  const bloqMax = r.episodiosDeBloqueio.reduce((a, e) => a + e.maximo, 0);
  const totalRodadas = r.totais.reduce((a, t) => a + (t.rodadas ?? 0), 0);
  const falhasProjecao = r.buracosProjecao.filter((b) => b.tipo === "falha");
  const minutosParados = falhasProjecao.reduce((a, b) => a + b.minutos, 0);
  const ocorrencias = ocorrenciasDaNoite(r);

  // --- séries ---------------------------------------------------------------
  const pedidosPorSegundo = soma(r.porMinuto.pedidosEstimados).map((v) => v / 60);
  const picoPedidos = Math.max(0, ...pedidosPorSegundo);
  const escalaPedidos = escalaBonita(Math.max(110, picoPedidos));
  const minutoDoPico = pedidosPorSegundo.indexOf(picoPedidos);
  const minutosAcimaDe100 = pedidosPorSegundo.filter((v) => v > 100).length;

  const novidadesTotal = soma(r.porMinuto.novidades);
  const picoNovidades = Math.max(0, ...novidadesTotal);
  const escalaNovidades = escalaBonita(picoNovidades);

  const apuradoSoma = degrausPorMinuto(
    r.apuradoPresidente.somaDosEstados.map((p) => ({ ms: msDeIso(p.hora), valor: p.pct })),
    inicioMs,
    minutos,
  );
  const apuradoBrasil = degrausPorMinuto(
    r.apuradoPresidente.arquivoBrasil.map((p) => ({ ms: msDeIso(p.hora), valor: p.pct })),
    inicioMs,
    minutos,
  );

  let maiorAtraso: { pontos: number; minuto: number } | null = null;
  for (let i = 0; i < minutos; i++) {
    const a = apuradoSoma[i];
    const b = apuradoBrasil[i];
    if (a === null || a === undefined || b === null || b === undefined) continue;
    if (!maiorAtraso || a - b > maiorAtraso.pontos) maiorAtraso = { pontos: a - b, minuto: i };
  }
  if (maiorAtraso && maiorAtraso.pontos <= 0) maiorAtraso = null;

  const cargosComRodada = r.cargos.filter((c) =>
    (CARGOS_COM_RODADA as readonly number[]).includes(c.cd),
  );
  const coletasFiltradas = filtrarCiclos(r.ciclos, filtro);
  const legendaCorrecoes = `${r.correcoes.length} correções, da mais antiga para a mais recente`;
  const legendaParados = `${r.arquivosParados.length} arquivos, pela hora da última novidade`;

  const falhasPorMinuto: {
    id: string;
    titulo: string;
    serie: SeriePorCargo;
    explica: string;
    /** Total como faixa, quando a soma pode contar o mesmo evento duas vezes. */
    faixa?: string;
    nota?: string;
    unidade: string;
  }[] = [
    {
      id: "erros",
      titulo: "Erros",
      unidade: "erros",
      serie: r.porMinuto.erros,
      explica: "pedidos que falharam (rede, resposta inválida), no minuto em que a coleta terminou",
    },
    {
      id: "bloqueios",
      titulo: "Bloqueios do TSE",
      unidade: "pedidos bloqueados",
      serie: r.porMinuto.bloqueios,
      explica:
        "pedidos que o TSE recusou por excesso (resposta 429), no minuto em que a coleta terminou",
      faixa: bloqMin === bloqMax ? undefined : `${fmtNum(bloqMin)} a ${fmtNum(bloqMax)}`,
      nota:
        bloqMin === bloqMax
          ? undefined
          : "Duas coletas simultâneas na mesma máquina relatam o mesmo contador, então o gráfico pode mostrar o mesmo bloqueio duas vezes.",
    },
    {
      id: "nao-encontrados",
      titulo: "Arquivos não encontrados",
      unidade: "arquivos não encontrados",
      serie: r.porMinuto.naoEncontrados,
      explica: "pedidos a que o TSE respondeu “não existe” (404)",
    },
  ];

  return (
    <>
      {/* ------------------------------------------------------------ resumo */}
      <section id="resumo" className={s.secao} aria-labelledby="t-resumo">
        <h2 id="t-resumo">Resumo em números</h2>
        <ul className={s.blocos}>
          <Bloco valor={fmtNum(totalPedidos)} rotulo="pedidos ao TSE" />
          <Bloco valor={fmtNum(totalNovidades)} rotulo="arquivos que chegaram com novidade" />
          <Bloco
            valor={fmtNum(totalColetas)}
            rotulo={`coletas concluídas${totalInterrompidas ? ` · ${totalInterrompidas} ${totalInterrompidas === 1 ? "não terminou" : "não terminaram"}` : ""}`}
          />
          <Bloco valor={fmtNum(totalErros)} rotulo="erros nos pedidos" />
          <Bloco
            valor={bloqMin === bloqMax ? fmtNum(bloqMin) : `${fmtNum(bloqMin)}–${fmtNum(bloqMax)}`}
            rotulo="pedidos bloqueados pelo TSE (faixa: ver nota)"
          />
          <Bloco valor={fmtNum(totalNaoEncontrados)} rotulo="arquivos não encontrados" />
          <Bloco valor={fmtNum(totalRodadas)} rotulo="rodadas da projeção" />
          <Bloco
            valor={`${falhasProjecao.length}×`}
            rotulo={`projeção parada por falha (${fmtNum(minutosParados)} min ao todo)`}
          />
          <Bloco
            valor={fmtNum(r.arquivosParados.length)}
            rotulo="arquivos que o TSE deixou parados"
          />
        </ul>

        <h3 className={s.explica} style={{ marginTop: "var(--space-6)" }}>
          Por cargo
        </h3>
        <TabelaRolavel rotulo={LEGENDA_POR_CARGO}>
          <table className={s.tabela}>
            <caption>{LEGENDA_POR_CARGO}</caption>
            <thead>
              <tr>
                <th scope="col">Cargo</th>
                <th scope="col">Coletas</th>
                <th scope="col">Não terminaram</th>
                <th scope="col">Pedidos</th>
                <th scope="col">Novidades</th>
                <th scope="col">Erros</th>
                <th scope="col">Bloqueios*</th>
                <th scope="col">Duração típica</th>
                <th scope="col">Mais longa</th>
                <th scope="col">Acima de 5 min</th>
                <th scope="col">Rodadas da projeção</th>
              </tr>
            </thead>
            <tbody>
              {r.totais.map((t) => (
                <tr key={t.cargo}>
                  <th scope="row">{nomeDoCargo(r, t.cargo)}</th>
                  <td>{fmtNum(t.ciclos)}</td>
                  <td>{fmtNum(t.interrompidos)}</td>
                  <td>{fmtNum(t.pedidos)}</td>
                  <td>{fmtNum(t.novidades)}</td>
                  <td>{fmtNum(t.erros)}</td>
                  <td>{fmtNum(t.bloqueios)}</td>
                  <td>{t.duracaoMedianaS === null ? "—" : `${fmtNum(t.duracaoMedianaS)} s`}</td>
                  <td>{t.duracaoMaximaS === null ? "—" : `${fmtNum(t.duracaoMaximaS)} s`}</td>
                  <td>{fmtNum(t.ciclosAcimaDe300s)}</td>
                  <td>{t.rodadas === null ? "não grava" : fmtNum(t.rodadas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TabelaRolavel>
        <p className={s.explica} style={{ marginTop: "var(--space-2)" }}>
          * O contador de bloqueios é da máquina, não da coleta: duas coletas rodando ao mesmo tempo
          na mesma máquina relatam o mesmo número. Por isso a soma por cargo pode contar o mesmo
          bloqueio duas vezes, e o resumo acima dá uma faixa.
        </p>
      </section>

      {/* ---------------------------------------------- corrida do Presidente */}
      <SecaoCorrida retrato={r} />

      {/* ------------------------------------------------------- ocorrências */}
      <section id="ocorrencias" className={s.secao} aria-labelledby="t-ocorrencias">
        <h2 id="t-ocorrencias">Ocorrências da noite</h2>
        <p className={s.explica}>
          Montadas automaticamente a partir dos registros, sem anotação à mão. Paradas da projeção
          por falta de novidade (de madrugada, quando o TSE já não mudava nada) não entram aqui:
          aparecem no gráfico da projeção.
        </p>
        {ocorrencias.length === 0 ? (
          <p>Nenhuma ocorrência registrada.</p>
        ) : (
          <ol className={s.ocorrencias}>
            {ocorrencias.map((o) => (
              <li key={`${o.ms}-${o.texto}`} className={s.ocorrencia}>
                <span className={s.ocorrenciaQuando}>{o.quando}</span>
                <span>
                  <span
                    className={`${s.selo} ${o.gravidade === "falha" ? s.seloFalha : s.seloAtencao}`}
                  >
                    {o.gravidade === "falha" ? "falha" : "atenção"}
                  </span>
                  {o.texto}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ---------------------------------------------------------- pedidos */}
      <section id="pedidos" className={s.secao} aria-labelledby="t-pedidos">
        <h2 id="t-pedidos">Pedidos ao TSE, minuto a minuto</h2>
        <p className={s.explica}>
          Quantos pedidos por segundo o sistema fez ao TSE, empilhados por cargo. A linha tracejada
          é o limite do TSE: 100 pedidos por segundo. <strong>É uma estimativa</strong>: o banco
          guarda quantos pedidos cada coleta fez, não a hora de cada pedido; aqui o total de cada
          coleta foi espalhado por igual ao longo do tempo que ela levou. Coletas que passaram tempo
          esperando a vez contam como se pedissem o tempo todo, então os picos podem estar
          exagerados. Os tracinhos na base marcam correções registradas no código (lista mais
          abaixo).
        </p>
        <GraficoPorMinuto
          inicioMs={inicioMs}
          minutos={minutos}
          series={seriesDe(r.porMinuto.pedidosEstimados)}
          modo="empilhado"
          yMax={escalaPedidos.yMax}
          fator={1 / 60}
          unidade="pedidos por segundo (estimativa)"
          casas={1}
          marcasY={escalaPedidos.marcas}
          referencia={{ valor: 100, rotulo: "limite do TSE: 100/s" }}
          marcas={marcas}
          alturaPx={220}
          mostrarTotal
          nome="Pedidos ao TSE"
          rotulo={`Pedidos ao TSE por segundo, estimados, de ${horaCurta(inicioMs)} a ${horaCurta(inicioMs + minutos * 60_000)}, empilhados por cargo. Pico estimado de ${fmtNum(picoPedidos, 0)} por segundo às ${horaCurta(inicioMs + minutoDoPico * 60_000)}; ${minutosAcimaDe100} minutos acima do limite de 100 por segundo na estimativa.`}
        />
        <VerEmTabela>
          <TabelaPorBlocos
            legenda="Pedidos ao TSE (estimativa) somados a cada 15 minutos, por cargo"
            inicioMs={inicioMs}
            minutos={minutos}
            colunas={colunasDe(r.porMinuto.pedidosEstimados)}
            total
          />
        </VerEmTabela>
      </section>

      {/* -------------------------------------------------------- novidades */}
      <section id="novidades" className={s.secao} aria-labelledby="t-novidades">
        <h2 id="t-novidades">Arquivos que chegaram com novidade</h2>
        <p className={s.explica}>
          Cada arquivo do TSE que chegou diferente da versão anterior e foi guardado. Contagem
          exata, por minuto, empilhada por cargo.
        </p>
        <GraficoPorMinuto
          inicioMs={inicioMs}
          minutos={minutos}
          series={seriesDe(r.porMinuto.novidades)}
          modo="empilhado"
          yMax={escalaNovidades.yMax}
          unidade="arquivos com novidade no minuto"
          marcasY={escalaNovidades.marcas}
          marcas={marcas}
          alturaPx={200}
          mostrarTotal
          nome="Arquivos com novidade"
          rotulo={`Arquivos com novidade por minuto, empilhados por cargo. Total de ${fmtNum(totalNovidades)}; pico de ${fmtNum(picoNovidades)} num único minuto, às ${horaCurta(inicioMs + novidadesTotal.indexOf(picoNovidades) * 60_000)}.`}
        />
        <VerEmTabela>
          <TabelaPorBlocos
            legenda="Arquivos com novidade somados a cada 15 minutos, por cargo"
            inicioMs={inicioMs}
            minutos={minutos}
            colunas={colunasDe(r.porMinuto.novidades)}
            total
          />
        </VerEmTabela>
      </section>

      {/* ----------------------------------------------------------- falhas */}
      <section id="falhas" className={s.secao} aria-labelledby="t-falhas">
        <h2 id="t-falhas">Erros, bloqueios e arquivos não encontrados</h2>
        <p className={s.explica}>
          Contados no minuto em que a coleta terminou (o banco não guarda a hora de cada pedido).
        </p>
        {falhasPorMinuto.map((f) => {
          const total = soma(f.serie);
          const pico = Math.max(0, ...total);
          const soma1 = total.reduce((a, v) => a + v, 0);
          if (soma1 === 0) {
            return (
              <p key={f.id}>
                <strong>{f.titulo}:</strong> nenhum na noite ({f.explica}).
              </p>
            );
          }
          const escala = escalaBonita(pico);
          return (
            <div key={f.id} style={{ marginBottom: "var(--space-6)" }}>
              <h3 className={s.subtitulo3}>
                {f.titulo}: {f.faixa ?? fmtNum(soma1)}
              </h3>
              <p className={s.explica}>
                {f.explica.charAt(0).toUpperCase()}
                {f.explica.slice(1)}.{f.nota ? ` ${f.nota}` : ""}
              </p>
              <GraficoPorMinuto
                inicioMs={inicioMs}
                minutos={minutos}
                series={seriesDe(f.serie)}
                modo="barras"
                yMax={escala.yMax}
                unidade={f.unidade}
                marcasY={escala.marcas}
                alturaPx={110}
                mostrarTotal
                nome={f.titulo}
                rotulo={`${f.titulo} por minuto, por cargo: ${f.faixa ?? fmtNum(soma1)} ao todo; pico de ${fmtNum(pico)} às ${horaCurta(inicioMs + total.indexOf(pico) * 60_000)}.`}
              />
              <VerEmTabela>
                <TabelaPorBlocos
                  legenda={`${f.titulo} somados a cada 15 minutos, por cargo`}
                  inicioMs={inicioMs}
                  minutos={minutos}
                  colunas={colunasDe(f.serie)}
                  total
                />
              </VerEmTabela>
            </div>
          );
        })}
      </section>

      {/* ---------------------------------------------------------- duração */}
      <section id="duracao" className={s.secao} aria-labelledby="t-duracao">
        <h2 id="t-duracao">Quanto tempo cada coleta levou</h2>
        <p className={s.explica}>
          Um ponto por coleta, no horário em que terminou e na altura do tempo que levou. A linha
          tracejada marca 5 minutos, o intervalo entre duas coletas do Presidente: acima dela, uma
          coleta invade a vez da seguinte.
        </p>
        <DuracaoDosCiclos
          inicioMs={inicioMs}
          minutos={minutos}
          cargos={r.cargos}
          ciclos={r.ciclos}
        />
        <VerEmTabela>
          <TabelaRolavel rotulo={LEGENDA_DURACAO}>
            <table className={s.tabela}>
              <caption>{LEGENDA_DURACAO}</caption>
              <thead>
                <tr>
                  <th scope="col">Cargo</th>
                  <th scope="col">Coletas</th>
                  <th scope="col">Duração típica</th>
                  <th scope="col">Mais longa</th>
                  <th scope="col">Acima de 5 min</th>
                  <th scope="col">Não terminaram</th>
                </tr>
              </thead>
              <tbody>
                {r.totais.map((t) => (
                  <tr key={t.cargo}>
                    <th scope="row">{nomeDoCargo(r, t.cargo)}</th>
                    <td>{fmtNum(t.ciclos)}</td>
                    <td>{t.duracaoMedianaS === null ? "—" : `${fmtNum(t.duracaoMedianaS)} s`}</td>
                    <td>{t.duracaoMaximaS === null ? "—" : `${fmtNum(t.duracaoMaximaS)} s`}</td>
                    <td>{fmtNum(t.ciclosAcimaDe300s)}</td>
                    <td>{fmtNum(t.interrompidos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabelaRolavel>
        </VerEmTabela>
      </section>

      {/* --------------------------------------------------------- projeção */}
      <section id="projecao" className={s.secao} aria-labelledby="t-projecao">
        <h2 id="t-projecao">Rodadas da projeção</h2>
        <p className={s.explica}>
          Cada tracinho é uma rodada do modelo de projeção. As faixas marcam paradas de mais de 10
          minutos: listradas e com borda cheia quando foi falha, lisas e com borda tracejada quando
          o TSE não mudou nada. Os Deputados não aparecem aqui: o modelo deles não grava rodadas no
          mesmo lugar.
        </p>
        <RodadasDaProjecao
          inicioMs={inicioMs}
          minutos={minutos}
          cargos={cargosComRodada}
          rodadas={r.rodadas}
          buracos={r.buracosProjecao}
        />
        <VerEmTabela>
          <TabelaRolavel rotulo={LEGENDA_PARADAS}>
            <table className={s.tabela}>
              <caption>{LEGENDA_PARADAS}</caption>
              <thead>
                <tr>
                  <th scope="col">Cargo</th>
                  <th scope="col">De</th>
                  <th scope="col">Até</th>
                  <th scope="col">Minutos</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Pedidos ao modelo sem resposta</th>
                </tr>
              </thead>
              <tbody>
                {r.buracosProjecao.map((b) => (
                  <tr key={`${b.cargo}-${b.de}`}>
                    <th scope="row">{nomeDoCargo(r, b.cargo)}</th>
                    <td className={s.mono}>{horaComDia(msDeIso(b.de), ref)}</td>
                    <td className={s.mono}>{horaComDia(msDeIso(b.ate), ref)}</td>
                    <td>{fmtNum(b.minutos)}</td>
                    <td>{b.tipo === "falha" ? "falha" : "sem novidade"}</td>
                    <td>
                      {b.acionamentosSemRodada} de {b.acionamentos}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabelaRolavel>
          <TabelaPorBlocos
            legenda="Rodadas da projeção a cada 15 minutos"
            inicioMs={inicioMs}
            minutos={minutos}
            colunas={cargosComRodada.map((c) => ({
              rotulo: c.nome,
              valores: r.porMinuto.rodadasProjecao[String(c.cd) as ChaveCargo],
            }))}
          />
        </VerEmTabela>
      </section>

      {/* ---------------------------------------------------------- apurado */}
      <section id="apurado" className={s.secao} aria-labelledby="t-apurado">
        <h2 id="t-apurado">% apurado do Presidente ao longo da noite</h2>
        <p className={s.explica}>
          A linha cheia é a conta que o site exibia: seções apuradas de todos os estados (e do
          exterior) somadas. A tracejada é o arquivo nacional do próprio TSE, que atrasava em
          relação aos estados
          {maiorAtraso
            ? ` — a maior diferença foi de ${fmtNum(maiorAtraso.pontos, 1)} pontos, às ${horaCurta(inicioMs + maiorAtraso.minuto * 60_000)}`
            : ""}
          . Refeito a partir dos arquivos guardados.
        </p>
        <GraficoPorMinuto
          inicioMs={inicioMs}
          minutos={minutos}
          series={[
            {
              chave: "soma",
              rotulo: "Soma dos estados (o que o site mostrava)",
              cor: corDoCargo(1),
              valores: apuradoSoma,
            },
            {
              chave: "brasil",
              rotulo: "Arquivo nacional do TSE",
              cor: "var(--color-text-muted)",
              valores: apuradoBrasil,
              tracejado: true,
            },
          ]}
          modo="linhas"
          yMax={100}
          unidade="% das seções apuradas"
          casas={1}
          marcasY={[0, 25, 50, 75, 100]}
          marcas={marcas}
          alturaPx={200}
          nome="% apurado do Presidente"
          rotulo={`Percentual apurado do Presidente: começa em ${fmtNum(r.apuradoPresidente.somaDosEstados[0]?.pct ?? 0, 1)}% e chega a ${fmtNum(r.apuradoPresidente.somaDosEstados.at(-1)?.pct ?? 0, 1)}% às ${horaCurta(msDeIso(r.apuradoPresidente.somaDosEstados.at(-1)?.hora ?? r.eixo.inicio))}; o arquivo nacional do TSE fica abaixo da soma dos estados durante a maior parte da noite.`}
        />
        <VerEmTabela>
          <TabelaPorBlocos
            legenda="% apurado do Presidente no fim de cada bloco de 15 minutos"
            inicioMs={inicioMs}
            minutos={minutos}
            agregacao="ultimo"
            casas={2}
            colunas={[
              { rotulo: "Soma dos estados", valores: apuradoSoma },
              { rotulo: "Arquivo nacional do TSE", valores: apuradoBrasil },
            ]}
          />
        </VerEmTabela>
      </section>

      {/* -------------------------------------------------------- correções */}
      <section id="correcoes" className={s.secao} aria-labelledby="t-correcoes">
        <h2 id="t-correcoes">Correções publicadas</h2>
        <p className={s.explica}>
          Mudanças registradas no código entre {horaComDia(msDeIso(r.fonte.janelaCorrecoes.de), 0)}{" "}
          e {horaComDia(msDeIso(r.fonte.janelaCorrecoes.ate), 0)}. O horário é o do{" "}
          <strong>registro da correção</strong>, não o da entrada no ar — a publicação leva alguns
          minutos e esse momento não fica guardado.
        </p>
        {r.correcoes.length === 0 ? (
          <p>Nenhuma correção no período.</p>
        ) : (
          <TabelaRolavel rotulo={legendaCorrecoes} alta>
            <table className={s.tabela}>
              <caption>{legendaCorrecoes}</caption>
              <thead>
                <tr>
                  <th scope="col">Hora do registro</th>
                  <th scope="col">Código</th>
                  <th scope="col">O que mudou</th>
                </tr>
              </thead>
              <tbody>
                {r.correcoes.map((c) => (
                  <tr key={c.hash}>
                    <th scope="row" className={s.mono}>
                      {horaComDia(msDeIso(c.hora), ref)}
                    </th>
                    <td className={s.mono}>{c.hash}</td>
                    <td className={s.texto}>{c.titulo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabelaRolavel>
        )}
      </section>

      {/* ---------------------------------------------------------- parados */}
      <section id="parados" className={s.secao} aria-labelledby="t-parados">
        <h2 id="t-parados">Arquivos que o TSE deixou parados</h2>
        <p className={s.explica}>
          Arquivos cuja última versão guardada na noite ainda não tinha todas as seções contadas: o
          TSE parou de atualizá-los antes do fim. Um arquivo que chega a 100% e para de mudar é o
          normal e não entra aqui.
        </p>
        {r.arquivosParados.length === 0 ? (
          <p>Nenhum arquivo parado incompleto.</p>
        ) : (
          <TabelaRolavel rotulo={legendaParados}>
            <table className={s.tabela}>
              <caption>{legendaParados}</caption>
              <thead>
                <tr>
                  <th scope="col">Cargo</th>
                  <th scope="col">UF</th>
                  <th scope="col">Município</th>
                  <th scope="col">Zona</th>
                  <th scope="col">Última novidade</th>
                  <th scope="col">Seções contadas</th>
                  <th scope="col">% contado</th>
                </tr>
              </thead>
              <tbody>
                {r.arquivosParados.map((a) => (
                  <tr key={`${a.cargo}-${a.uf}-${a.codMunicipioTse}-${a.zona}-${a.nivel}`}>
                    <th scope="row">{nomeDoCargo(r, a.cargo)}</th>
                    <td>{a.uf}</td>
                    <td className={s.texto}>
                      {a.nivel === "zona"
                        ? (a.municipio ?? `código ${a.codMunicipioTse}`)
                        : `arquivo ${a.nivel}`}
                    </td>
                    <td>{a.nivel === "zona" ? a.zona : "—"}</td>
                    <td className={s.mono}>{horaComDia(msDeIso(a.ultimaNovidade), ref)}</td>
                    <td>
                      {fmtNum(a.secoesTotalizadas)} de {fmtNum(a.secoesTotal)}
                    </td>
                    <td>{fmtNum((100 * a.secoesTotalizadas) / a.secoesTotal, 1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabelaRolavel>
        )}
      </section>

      {/* ---------------------------------------------------------- coletas */}
      <section id="coletas" className={s.secao} aria-labelledby="t-coletas">
        <h2 id="t-coletas">Todas as coletas</h2>
        <p className={s.explica}>
          “Iguais”: arquivos que o TSE devolveu sem mudança. “Espera”: segundos que a coleta esperou
          de propósito para não passar do limite de pedidos. “Pediu projeção”: se a coleta trouxe
          novidade e chamou o modelo. Por padrão a lista mostra só as coletas com algum problema.
        </p>
        <FiltroDeCiclos retrato={r} filtro={filtro} />
        <TabelaDeCiclos retrato={r} ciclos={coletasFiltradas} total={r.ciclos.length} />
      </section>

      {/* --------------------------------------------------- não registrado */}
      <section id="nao-registrado" className={s.secao} aria-labelledby="t-nao">
        <h2 id="t-nao">O que não é registrado</h2>
        <ul className={s.lista}>
          <li>
            <strong>Cada pedido ao TSE, um por um.</strong> O banco guarda só o total de cada coleta
            — por isso o gráfico de pedidos é uma estimativa.
          </li>
          <li>
            <strong>As mensagens de texto do sistema (os “logs”).</strong> Vão para a tela de
            registros da Vercel, que as apaga depois de pouco tempo. Não entram aqui.
          </li>
          <li>
            <strong>O tempo de resposta do TSE a cada pedido</strong> e o momento exato de cada
            bloqueio.
          </li>
          <li>
            <strong>Rodadas da projeção dos Deputados.</strong> O modelo deles não grava rodadas na
            mesma tabela dos outros cargos.
          </li>
          <li>
            <strong>A hora em que cada correção entrou no ar.</strong> Só a hora em que foi
            registrada no código.
          </li>
        </ul>
        <p className={s.explica} style={{ marginTop: "var(--space-4)" }}>
          Retrato no formato {r.versao}; correções lidas de <code>{r.fonte.gitRef}</code>;{" "}
          {r.fonte.linhasIgnoradas} registro(s) de coleta ignorado(s) por estarem ilegíveis ou fora
          do turno.
        </p>
      </section>
    </>
  );
}

function Bloco({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <li className={s.bloco}>
      <span className={s.blocoValor}>{valor}</span>
      <span className={s.blocoRotulo}>{rotulo}</span>
    </li>
  );
}
