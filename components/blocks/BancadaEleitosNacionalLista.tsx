"use client";

/**
 * components/blocks/BancadaEleitosNacionalLista.tsx — spec 026 RF-299 e RF-300.
 *
 * A lista aberta de UMA agremiação na capa `/deputado-federal`: os eleitos do
 * país inteiro, agrupados por UF. Carregada só no primeiro clique em "Ver os
 * eleitos" (`next/dynamic` em `BancadaEleitosNacional.tsx`) — selos, avatar e
 * formatação não pesam em quem nunca abre.
 *
 * ## O que entra, em cada base
 *
 *   - **Parcial**: só quem tem marca de eleito na parcial ou "Eleito (TSE)".
 *     Quem está marcado SÓ na projeção não aparece (RF-299).
 *   - **Projeção, com cenário** (projeção ligada E X > 0): nas UFs liberadas,
 *     os eleitos na projeção, com "eleito na projeção · não oficial"; nas
 *     travadas, os eleitos na parcial, sob "parcial — projeção ainda travada
 *     neste estado"; nas totalizadas, "Eleito (TSE)" (RF-267). Cada nome diz
 *     de onde veio (RF-300).
 *   - **Projeção sem cenário** (desligada, ou X = 0): a parcial, com a frase
 *     que diz por quê — e nunca a expressão "cenário projetado" (RF-300).
 *
 * A ordem é a da resposta: UF por sigla, depois `rank` de apuração. Nada aqui
 * reordena (constituição § 2 e § 6, ADR-0063 D5). Voto projetado por
 * candidato não existe na resposta (RF-297).
 *
 * A contagem do cabeçalho é a dos NOMES recebidos (Blob), e pode diferir por
 * um ciclo do número da linha (payload nacional): nenhuma é ajustada para
 * igualar a outra (RF-299).
 */

import { MarcaDeputado } from "@/components/atoms/badges/MarcaDeputado";
import { CandidateAvatar } from "@/components/atoms/data/CandidateAvatar";
import { primeiroTurnoEncerrado } from "@/lib/config/calendar";
import {
  type EleitosNacionais,
  FRASE_NENHUMA_LIBERADA,
  FRASE_PROJECAO_DESLIGADA,
  type LinhaEleitoNacional,
  LN,
  rotuloDoMisto,
  type VisaoDoCenario,
  visaoDoCenario,
} from "@/lib/deputado/eleitos-nacionais-visao";
import type { ViewMode } from "@/lib/state/view-mode";
import { BIT_MARCA, marcasDosBits } from "@/lib/utils/deputado-marcas";
import { formatPercent, formatVotes } from "@/lib/utils/format";
import { AVATAR_ELEITO_PX } from "./AvatarEleito";
import estilos from "./BancadaEleitosNacional.module.css";
import estilosAvatar from "./DeputadoListaAgremiacao.module.css";

const BITS_PROJECAO = BIT_MARCA.PROJECAO | BIT_MARCA.PROJECAO_SOBRA | BIT_MARCA.PROJECAO_APERTADA;
const BITS_ELEITO = BIT_MARCA.PARCIAL | BIT_MARCA.TSE;

/** De onde vêm os nomes de um grupo — e o texto que diz isso. */
export type OrigemGrupo = "parcial" | "tse" | "projecao" | "travada";

export interface GrupoUf {
  uf: string;
  origem: OrigemGrupo;
  linhas: LinhaEleitoNacional[];
}

/**
 * Os grupos por UF de UMA agremiação, na base pedida. Pura. As UFs saem por
 * sigla e as linhas na ordem recebida (o `rank`), qualquer que seja a ordem
 * de chegada das UFs.
 */
export function gruposDaLista(
  linhas: readonly LinhaEleitoNacional[],
  modo: ViewMode,
  visao: VisaoDoCenario,
  ufsTse: ReadonlySet<string>,
): GrupoUf[] {
  const comCenario = modo === "proj" && visao.pronto;
  const porUf = new Map<string, GrupoUf>();
  for (const linha of linhas) {
    const uf = linha[LN.UF];
    const bits = linha[LN.MARCAS];
    const liberada = comCenario && visao.liberadas.has(uf);
    const entra = liberada ? (bits & BIT_MARCA.PROJECAO) !== 0 : (bits & BITS_ELEITO) !== 0;
    if (!entra) continue;
    let grupo = porUf.get(uf);
    if (!grupo) {
      grupo = {
        uf,
        origem: liberada ? "projecao" : ufsTse.has(uf) ? "tse" : comCenario ? "travada" : "parcial",
        linhas: [],
      };
      porUf.set(uf, grupo);
    }
    grupo.linhas.push(linha);
  }
  return [...porUf.values()].sort((a, b) => (a.uf < b.uf ? -1 : a.uf > b.uf ? 1 : 0));
}

/** Os bits que a linha MOSTRA no grupo: a marca da base do grupo, e só ela. */
function bitsExibidos(bits: number, origem: OrigemGrupo): number {
  return origem === "projecao" ? bits & BITS_PROJECAO : bits & ~BITS_PROJECAO;
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

/** "SP · 2 eleitos na parcial" — nunca "eleito" solto (RF-266). */
function tituloDoGrupo(g: GrupoUf): { titulo: string; nota: string | null } {
  const n = g.linhas.length;
  const eleitos = plural(n, "eleito", "eleitos");
  switch (g.origem) {
    case "projecao":
      return { titulo: `${g.uf} · ${eleitos} na projeção · não oficial`, nota: null };
    case "tse":
      return { titulo: `${g.uf} · ${eleitos} (TSE)`, nota: null };
    case "travada":
      // 1º turno encerrado: contagem final — sem "na parcial" nem projeção.
      if (primeiroTurnoEncerrado()) return { titulo: `${g.uf} · ${eleitos}`, nota: null };
      return {
        titulo: `${g.uf} · ${eleitos} na parcial`,
        nota: " — projeção ainda travada neste estado",
      };
    case "parcial":
      return {
        titulo: primeiroTurnoEncerrado()
          ? `${g.uf} · ${eleitos}`
          : `${g.uf} · ${eleitos} na parcial`,
        nota: null,
      };
  }
}

/** O cabeçalho da lista: quantos nomes, em quantos estados, e de que base. */
function cabecalho(
  grupos: readonly GrupoUf[],
  comCenario: boolean,
  visao: VisaoDoCenario,
  sigla: string,
): string {
  const n = grupos.reduce((s, g) => s + g.linhas.length, 0);
  const k = grupos.length;
  if (comCenario) {
    return n === 0
      ? `Ninguém de ${sigla} entra no cenário projetado · não oficial.`
      : `${n} no cenário projetado · não oficial, pontual · ${rotuloDoMisto(visao)}.`;
  }
  const estados = plural(k, "estado", "estados");
  // 1º turno encerrado (05/10/2026): a contagem é a final do TSE.
  if (primeiroTurnoEncerrado()) {
    return n === 0
      ? `Ninguém de ${sigla} foi eleito.`
      : `${plural(n, "eleito", "eleitos")} em ${estados} — contagem final do TSE.`;
  }
  if (n === 0) return `Ninguém de ${sigla} está sendo eleito na parcial agora.`;
  if (grupos.every((g) => g.origem === "tse")) {
    return `${plural(n, "eleito", "eleitos")} (TSE) em ${estados} — resultado oficial.`;
  }
  if (grupos.some((g) => g.origem === "tse")) {
    return `${n} eleitos em ${estados}, na parcial ou pelo TSE · eleito na parcial não é resultado oficial.`;
  }
  return `${plural(n, "eleito", "eleitos")} na parcial em ${estados} · eleito na parcial não é resultado oficial.`;
}

export interface BancadaEleitosNacionalListaProps {
  dados: EleitosNacionais;
  /** O interruptor lido pela PÁGINA (ADR-0063 D4) — desligado, a projeção da resposta é ignorada. */
  ligada: boolean;
  cod: string;
  sigla: string;
  modo: ViewMode;
}

export function BancadaEleitosNacionalLista({
  dados,
  ligada,
  cod,
  sigla,
  modo,
}: BancadaEleitosNacionalListaProps) {
  const visao = visaoDoCenario(dados, ligada);
  const comCenario = modo === "proj" && visao.pronto;
  const linhas = dados.agremiacoes.find((a) => a.cod === cod)?.linhas ?? [];
  const grupos = gruposDaLista(linhas, modo, visao, new Set(dados.ufs_tse));
  const aviso =
    modo === "proj" && !visao.pronto
      ? visao.ligada
        ? FRASE_NENHUMA_LIBERADA
        : FRASE_PROJECAO_DESLIGADA
      : null;

  return (
    <div
      className="flex flex-col"
      style={{ gap: "var(--space-3)" }}
      data-testid="bancada-eleitos-lista"
    >
      {aviso ? (
        <p className={estilos.cabecalho} data-testid="bancada-eleitos-aviso">
          {aviso}
        </p>
      ) : null}
      <p className={estilos.cabecalho} data-testid="bancada-eleitos-cabecalho">
        <strong>{cabecalho(grupos, comCenario, visao, sigla)}</strong> Ao lado de cada nome, o voto
        apurado e o percentual dos votos válidos do estado.
      </p>
      {visao.z > 0 ? (
        <p className={estilos.cabecalho} data-testid="bancada-eleitos-sem-dado">
          {`Sem dado agora, fora da conta: ${dados.ufs_sem_dado.join(", ")}.`}
        </p>
      ) : null}

      {grupos.length > 0 ? (
        <ul className={estilos.grupos}>
          {grupos.map((g) => {
            const { titulo, nota } = tituloDoGrupo(g);
            return (
              <li key={g.uf} data-uf={g.uf} data-origem={g.origem}>
                <p>
                  {titulo}
                  {nota ? <small>{nota}</small> : null}
                </p>
                <ol
                  className={estilos.nomes}
                  aria-label={`${sigla} em ${g.uf}, por votos apurados`}
                >
                  {g.linhas.map((l) => {
                    const sq = l[LN.SQCAND];
                    const bits = l[LN.MARCAS];
                    const foto = l[LN.FOTO];
                    const numero = l[LN.NUMERO];
                    const pct = l[LN.PCT];
                    const meta = [numero === null ? null : `nº ${numero}`, l[LN.PARTIDO] || null]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <li key={sq} data-sqcand={sq}>
                        <span>
                          {/* RF-291, emenda de 04/10 (dono, revisão na tela):
                              aqui TODO nome listado está sendo eleito na base
                              exibida, então todos levam o círculo — foto
                              quando publicada, senão iniciais. A regra "só
                              eleito na parcial/TSE" é das listas de UF, que
                              mostram também quem não se elege. */}
                          <CandidateAvatar
                            nome={l[LN.NOME]}
                            fotoUrl={foto ?? null}
                            width={AVATAR_ELEITO_PX}
                            height={AVATAR_ELEITO_PX}
                            responsive={false}
                            rounded
                            semEstiloInline
                            className={estilosAvatar.avatar}
                          />
                          <b>{l[LN.NOME]}</b>
                          {meta ? <small>{meta}</small> : null}
                          {marcasDosBits(bitsExibidos(bits, g.origem)).map((m) => (
                            <MarcaDeputado key={m.tipo} marca={m} />
                          ))}
                        </span>
                        <span>
                          {formatVotes(l[LN.VOTOS])}
                          {pct !== null ? <small>{formatPercent(pct, 2)}</small> : null}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
