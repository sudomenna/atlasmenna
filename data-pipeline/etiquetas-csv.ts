// data-pipeline/etiquetas-csv.ts
//
// Leitura dos CSVs editados à mão em `editorial/etiquetas/` (spec 024, RF-221).
// Puro: recebe o texto, devolve linhas e erros com número de linha. Nada de
// disco aqui — o teste passa texto literal.
//
// Formato: RFC 4180 com vírgula, UTF-8 (BOM tolerado), aspas duplas para
// campo com vírgula/aspas/quebra, `""` como aspa literal. É o que qualquer
// planilha (Google Sheets, Excel, Numbers) exporta como "CSV UTF-8".
//
// O cabeçalho é **exato e na ordem** de `COLUNAS_FONTE`: coluna renomeada ou
// trocada de lugar numa planilha mudaria o significado de cada linha sem erro
// nenhum, e aqui isso é recusado de saída.

import { COLUNAS_FONTE } from "@/lib/etiquetas/catalogo";

export type ColunaFonte = (typeof COLUNAS_FONTE)[number];

export interface LinhaFonte {
  /** Número da linha física no arquivo (1 = cabeçalho). */
  linha: number;
  campos: Record<ColunaFonte, string>;
}

export interface ErroCompilacao {
  arquivo: string;
  linha: number | null;
  mensagem: string;
}

/** Divide o texto em registros e campos (RFC 4180). */
export function tokenizarCsv(texto: string): Array<{ linha: number; campos: string[] }> {
  const s = texto.startsWith("﻿") ? texto.slice(1) : texto;
  const registros: Array<{ linha: number; campos: string[] }> = [];
  let campos: string[] = [];
  let atual = "";
  let emAspas = false;
  let linhaFisica = 1;
  let linhaDoRegistro = 1;
  let temConteudo = false;

  const fecharRegistro = () => {
    campos.push(atual);
    // Linha totalmente vazia (inclusive a do fim do arquivo) não é registro.
    if (temConteudo || campos.length > 1 || campos[0] !== "") {
      registros.push({ linha: linhaDoRegistro, campos });
    }
    campos = [];
    atual = "";
    temConteudo = false;
  };

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (emAspas) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          atual += '"';
          i++;
        } else {
          emAspas = false;
        }
      } else {
        if (ch === "\n") linhaFisica++;
        atual += ch;
      }
      continue;
    }
    if (ch === '"') {
      emAspas = true;
      temConteudo = true;
    } else if (ch === ",") {
      campos.push(atual);
      atual = "";
      temConteudo = true;
    } else if (ch === "\r") {
      // CRLF: o \n seguinte fecha o registro.
    } else if (ch === "\n") {
      fecharRegistro();
      linhaFisica++;
      linhaDoRegistro = linhaFisica;
    } else {
      atual += ch;
      temConteudo = true;
    }
  }
  if (emAspas) {
    // Aspas abertas até o fim: o registro inteiro é suspeito. Entregamos para
    // que a validação de colunas acuse com o número de linha.
    registros.push({ linha: linhaDoRegistro, campos: [...campos, atual, "\u0000aspas-abertas"] });
  } else if (temConteudo || atual !== "" || campos.length > 0) {
    fecharRegistro();
  }
  return registros;
}

export function parseCsvEtiquetas(
  texto: string,
  arquivo: string,
): { linhas: LinhaFonte[]; erros: ErroCompilacao[] } {
  const erros: ErroCompilacao[] = [];
  const registros = tokenizarCsv(texto);
  if (registros.length === 0) {
    erros.push({ arquivo, linha: null, mensagem: "arquivo vazio — falta o cabeçalho" });
    return { linhas: [], erros };
  }

  const [cab, ...corpo] = registros;
  const cabecalho = (cab?.campos ?? []).map((c) => c.trim());
  if (
    cabecalho.length !== COLUNAS_FONTE.length ||
    cabecalho.some((c, i) => c !== COLUNAS_FONTE[i])
  ) {
    erros.push({
      arquivo,
      linha: 1,
      mensagem: `cabeçalho deve ser exatamente "${COLUNAS_FONTE.join(",")}" — veio "${cabecalho.join(",")}"`,
    });
    return { linhas: [], erros };
  }

  const linhas: LinhaFonte[] = [];
  for (const r of corpo) {
    if (r.campos.length !== COLUNAS_FONTE.length) {
      erros.push({
        arquivo,
        linha: r.linha,
        mensagem: `esperadas ${COLUNAS_FONTE.length} colunas, vieram ${r.campos.length} (vírgula dentro de campo sem aspas?)`,
      });
      continue;
    }
    const campos = {} as Record<ColunaFonte, string>;
    COLUNAS_FONTE.forEach((col, i) => {
      campos[col] = (r.campos[i] ?? "").trim();
    });
    linhas.push({ linha: r.linha, campos });
  }
  return { linhas, erros };
}
