/**
 * lib/painel/apresentar.ts
 *
 * Do retrato para o texto que o dono lê: a lista de ocorrências da noite, o
 * filtro da tabela de ciclos, os nomes dos cargos. Puro, sem I/O.
 *
 * Usado só pelos componentes de SERVIDOR do painel — ele lê campos do retrato
 * pelo nome, e não há por que esse código ir para o navegador.
 */

import { fmtNum, horaComDia, msDeIso } from "./eixo";
import type { CargoDoPainel, CicloPainel, RetratoPainel } from "./tipos";

export function nomeDoCargo(retrato: Pick<RetratoPainel, "cargos">, cd: number): string {
  return retrato.cargos.find((c) => c.cd === cd)?.nome ?? `Cargo ${cd}`;
}

/** "Deputado Federal (parte 3 de 6)" — a fatia em português. */
export function nomeComFatia(
  retrato: Pick<RetratoPainel, "cargos">,
  cd: number,
  fatia: number | null,
): string {
  return fatia ? `${nomeDoCargo(retrato, cd)} (parte ${fatia})` : nomeDoCargo(retrato, cd);
}

/** Ciclo que merece olhar: não terminou, saiu cedo, errou, foi bloqueado, achou 404 ou passou de 5 min. */
export function cicloTemProblema(c: CicloPainel): boolean {
  return (
    c.fim === null ||
    c.abortado !== null ||
    (c.erros ?? 0) > 0 ||
    (c.bloqueios ?? 0) > 0 ||
    (c.naoEncontrados ?? 0) > 0 ||
    (c.duracaoS ?? 0) > 300
  );
}

export interface FiltroCiclos {
  cargo: CargoDoPainel | null;
  soProblemas: boolean;
}

/**
 * Lê `?cargo=` e `?so=todas` da URL. Cargo desconhecido = todos os cargos.
 *
 * O padrão é mostrar SÓ as coletas com problema: a noite tem ~900 coletas, e
 * a lista inteira no celular é ilegível e pesa no HTML. `?so=todas` mostra
 * todas.
 */
export function lerFiltroCiclos(
  params: Record<string, string | string[] | undefined>,
): FiltroCiclos {
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const cargo = Number(um(params.cargo));
  return {
    cargo: [1, 3, 5, 6, 7, 8].includes(cargo) ? (cargo as CargoDoPainel) : null,
    soProblemas: um(params.so) !== "todas",
  };
}

export function filtrarCiclos(ciclos: readonly CicloPainel[], f: FiltroCiclos): CicloPainel[] {
  return ciclos.filter(
    (c) => (f.cargo === null || c.cargo === f.cargo) && (!f.soProblemas || cicloTemProblema(c)),
  );
}

export interface Ocorrencia {
  /** Para ordenar. */
  ms: number;
  quando: string;
  gravidade: "falha" | "atencao";
  texto: string;
}

/** Erros num único ciclo a partir dos quais o ciclo vira ocorrência. */
export const ERROS_PARA_OCORRENCIA = 10;

/**
 * A linha do tempo dos problemas, montada só a partir do retrato — nada é
 * anotado à mão. Entram:
 *
 *   - projeção parada por FALHA (o modelo foi chamado e não gravou);
 *   - ciclo que começou e não terminou;
 *   - episódio de bloqueio pelo TSE;
 *   - sequência de ciclos parada além do dobro do normal;
 *   - arquivos que o TSE deixou de atualizar incompletos (agrupados por cargo);
 *   - ciclo com {@link ERROS_PARA_OCORRENCIA} erros ou mais.
 *
 * NÃO entram os buracos "sem novidade": a projeção só roda quando o TSE muda
 * algo, então de madrugada ela para por desenho — isso aparece no gráfico, não
 * aqui.
 */
export function ocorrenciasDaNoite(r: RetratoPainel): Ocorrencia[] {
  const ref = msDeIso(r.janela.de);
  const h = (iso: string) => horaComDia(msDeIso(iso), ref);
  const out: Ocorrencia[] = [];

  for (const b of r.buracosProjecao) {
    if (b.tipo !== "falha") continue;
    const vezes = b.acionamentosSemRodada === 1 ? "1 vez" : `${b.acionamentosSemRodada} vezes`;
    out.push({
      ms: msDeIso(b.de),
      quando: `${h(b.de)} a ${h(b.ate)}`,
      gravidade: "falha",
      texto: `Projeção de ${nomeDoCargo(r, b.cargo)} parada por ${fmtNum(b.minutos)} min: o modelo foi chamado ${vezes} e não gravou resultado.`,
    });
  }
  for (const c of r.ciclos) {
    if (c.fim !== null) continue;
    out.push({
      ms: msDeIso(c.inicio),
      quando: h(c.inicio),
      gravidade: "falha",
      texto: `Uma coleta de ${nomeComFatia(r, c.cargo, c.fatia)} começou e não terminou — não deixou registro de fim (o servidor a interrompeu).`,
    });
  }
  for (const e of r.episodiosDeBloqueio) {
    const quem = e.ciclos.map((c) => nomeComFatia(r, c.cargo, c.fatia)).join(" e ");
    const quanto =
      e.minimo === e.maximo
        ? `${fmtNum(e.minimo)} pedidos`
        : `entre ${fmtNum(e.minimo)} e ${fmtNum(e.maximo)} pedidos`;
    out.push({
      ms: msDeIso(e.de),
      quando: `${h(e.de)} a ${h(e.ate)}`,
      gravidade: "falha",
      texto: `O TSE recusou pedidos por excesso (bloqueio): ${quanto}, durante coletas de ${quem}.`,
    });
  }
  for (const b of r.buracosCiclos) {
    out.push({
      ms: msDeIso(b.de),
      quando: `${h(b.de)} a ${h(b.ate)}`,
      gravidade: "atencao",
      texto: `${nomeComFatia(r, b.cargo, b.fatia)} ficou ${fmtNum(b.minutos)} min sem terminar uma coleta (o normal era a cada ${fmtNum(b.medianaMinutos)} min).`,
    });
  }
  const paradosPorCargo = new Map<number, RetratoPainel["arquivosParados"]>();
  for (const a of r.arquivosParados) {
    paradosPorCargo.set(a.cargo, [...(paradosPorCargo.get(a.cargo) ?? []), a]);
  }
  for (const [cargo, lista] of paradosPorCargo) {
    const horas = lista.map((a) => msDeIso(a.ultimaNovidade)).sort((a, b) => a - b);
    const de = horas[0] as number;
    const ate = horas[horas.length - 1] as number;
    const n = lista.length;
    out.push({
      ms: de,
      quando: de === ate ? horaComDia(de, ref) : `${horaComDia(de, ref)} a ${horaComDia(ate, ref)}`,
      gravidade: "falha",
      texto: `${n} ${n === 1 ? "arquivo" : "arquivos"} de ${nomeDoCargo(r, cargo)} ${n === 1 ? "parou" : "pararam"} de ser atualizados pelo TSE antes de terminar a contagem (detalhe na seção "Arquivos que o TSE deixou parados").`,
    });
  }
  for (const c of r.ciclos) {
    if ((c.erros ?? 0) < ERROS_PARA_OCORRENCIA || c.fim === null) continue;
    out.push({
      ms: msDeIso(c.fim),
      quando: h(c.fim),
      gravidade: "atencao",
      texto: `Uma coleta de ${nomeComFatia(r, c.cargo, c.fatia)} terminou com ${fmtNum(c.erros ?? 0)} erros (de ${fmtNum(c.pedidos ?? 0)} pedidos).`,
    });
  }
  return out.sort((a, b) => a.ms - b.ms);
}
