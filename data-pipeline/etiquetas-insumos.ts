// data-pipeline/etiquetas-insumos.ts
//
// Os insumos **produzidos por outras frentes** que o compilador de etiquetas
// lê (spec 024, RF-226/227). Todos podem faltar — a ausência nunca é erro; o
// que a ausência significa está escrito em cada leitor.
//
//   editorial/senado/mandato-2031.json          (frente 023 — a foto dos 27)
//   editorial/derivados/trajetoria-camara.json  (cargo 6: sqcand → camara_ids)
//   editorial/derivados/alinhamento-camara.json (camara_id → votos/taxa)
//   editorial/derivados/trajetoria-senado.json  (cargo 5: sqcand → senado_codigos)
//   editorial/derivados/alinhamento-senado.json (código do Senado → votos/taxa)
//
// Puro: recebe o JSON já parseado. Os erros voltam como texto; o núcleo
// (`etiquetas-nucleo.ts`) os converte em erros de compilação.
//
// ─── Dado pessoal: recusado na porta (RF-229, ADR-0062) ─────────────────────
//
// O casamento de nome + nascimento com o cadastro do Parlamento é feito **só
// em memória** pela frente que gera os derivados. Se um desses arquivos chegar
// aqui com um campo de nome, nascimento, CPF, título ou e-mail, a compilação
// para: nada que carregue esses campos passa por este pipeline. A foto do
// Senado é a exceção controlada — traz nome, e é lida por lista branca
// (código, UF, partido), sem copiar mais nada.

import {
  ALINHAMENTO_CORTE,
  SEM_PARTIDO,
  TRAJETORIA_PARA_VALOR,
  type TrajetoriaDerivada,
} from "@/lib/etiquetas/catalogo";
import { type FonteDerivada, normalizarSigla, normalizarSqcand } from "@/lib/etiquetas/formato";

/** Nome de campo que denuncia dado pessoal. */
export const PADRAO_CAMPO_PESSOAL =
  /(nasc|cpf|titulo|e-?mail|nome_civil|nome_social|nm_candidato|nome_completo|^nome$|^nm_)/i;

/** Varre todas as chaves, em qualquer profundidade. Devolve os caminhos ofensivos. */
export function camposPessoais(v: unknown, caminho = "$"): string[] {
  const out: string[] = [];
  if (Array.isArray(v)) {
    v.forEach((x, i) => {
      out.push(...camposPessoais(x, `${caminho}[${i}]`));
    });
  } else if (typeof v === "object" && v !== null) {
    for (const [k, x] of Object.entries(v)) {
      if (PADRAO_CAMPO_PESSOAL.test(k)) out.push(`${caminho}.${k}`);
      out.push(...camposPessoais(x, `${caminho}.${k}`));
    }
  }
  return out;
}

type Resultado<T> = { ok: true; valor: T; avisos: string[] } | { ok: false; erros: string[] };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

function primeiro(o: Record<string, unknown>, nomes: readonly string[]): unknown {
  for (const n of nomes) if (o[n] !== undefined && o[n] !== null) return o[n];
  return undefined;
}

/** Sigla do partido como a foto do Senado escreve; "S/Partido" ⇒ `null`. */
export function partidoDaFoto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === "" || SEM_PARTIDO.test(s)) return null;
  return normalizarSigla(s);
}

// ---------------------------------------------------------------------------
// Foto do Senado — os 27 até 2031
// ---------------------------------------------------------------------------

export interface Senado2031Insumo {
  /** `true` só com exatamente 27, um por UF. */
  completo: boolean;
  foto: string | null;
  /** código parlamentar → UF e partido atual (normalizado; `null` = sem partido). */
  senadores: ReadonlyMap<string, { uf: string; partido: string | null }>;
}

/**
 * Leitura **tolerante** de `mandato-2031.json`: o formato é da frente 023 e
 * ainda não está congelado. Aceita a lista na raiz ou sob `senadores` /
 * `cadeiras` / `parlamentares` / `mandatos`, e cada item com `codigo` /
 * `codigo_parlamentar` / `CodigoParlamentar`, `uf` / `sigla_uf`, `partido` /
 * `partido_atual` / `sigla_partido`. **Copia só** código, UF e partido.
 */
export function lerSenado2031(json: unknown): Resultado<Senado2031Insumo> {
  let lista: unknown;
  let foto: unknown;
  if (Array.isArray(json)) lista = json;
  else if (isObj(json)) {
    lista = primeiro(json, ["senadores", "cadeiras", "parlamentares", "mandatos"]);
    foto = primeiro(json, ["data_foto", "foto", "data", "gerado_em"]);
  }
  if (!Array.isArray(lista)) {
    return { ok: false, erros: ["mandato-2031.json: não achei a lista de senadores"] };
  }
  const erros: string[] = [];
  const senadores = new Map<string, { uf: string; partido: string | null }>();
  lista.forEach((item, i) => {
    if (!isObj(item)) {
      erros.push(`mandato-2031.json[${i}]: item não é objeto`);
      return;
    }
    const cod = primeiro(item, ["codigo", "codigo_parlamentar", "CodigoParlamentar"]);
    const uf = primeiro(item, ["uf", "sigla_uf", "UfParlamentar"]);
    const partido = primeiro(item, ["partido", "partido_atual", "sigla_partido"]);
    if ((typeof cod !== "string" && typeof cod !== "number") || String(cod).trim() === "") {
      erros.push(`mandato-2031.json[${i}]: sem código parlamentar`);
      return;
    }
    if (typeof uf !== "string" || !/^[A-Za-z]{2}$/.test(uf.trim())) {
      erros.push(`mandato-2031.json[${i}]: UF inválida`);
      return;
    }
    const codigo = String(cod).trim();
    if (senadores.has(codigo)) {
      erros.push(`mandato-2031.json: código ${codigo} repetido`);
      return;
    }
    senadores.set(codigo, { uf: uf.trim().toUpperCase(), partido: partidoDaFoto(partido) });
  });
  if (erros.length > 0) return { ok: false, erros };
  const ufs = new Set([...senadores.values()].map((s) => s.uf));
  const completo = senadores.size === 27 && ufs.size === 27;
  const avisos = completo
    ? []
    : [
        `mandato-2031.json tem ${senadores.size} senadores em ${ufs.size} UFs (esperado 27 em 27) — ` +
          `senado2031 fica indisponível para o portão`,
      ];
  return {
    ok: true,
    valor: { completo, foto: typeof foto === "string" ? foto : null, senadores },
    avisos,
  };
}

// ---------------------------------------------------------------------------
// Proveniência declarada pelo insumo
// ---------------------------------------------------------------------------

export type Casa = "camara" | "senado";

/**
 * Fonte usada quando o insumo não declara a sua — a origem real dos derivados
 * (Dados Abertos de cada casa). Se o insumo declarar, vale o que ele diz.
 */
export const FONTE_PADRAO: Readonly<Record<Casa, { fonte_url: string; fonte_descricao: string }>> =
  {
    camara: {
      fonte_url: "https://dadosabertos.camara.leg.br/",
      fonte_descricao: "Câmara dos Deputados — Dados Abertos",
    },
    senado: {
      fonte_url: "https://legis.senado.leg.br/dadosabertos/",
      fonte_descricao: "Senado Federal — Dados Abertos",
    },
  };

function fonteDeclarada(
  v: unknown,
  data: string,
  casa: Casa,
  descricaoPadrao: string,
): FonteDerivada {
  const padrao = FONTE_PADRAO[casa];
  if (typeof v === "string" && /^https?:\/\//.test(v.trim())) {
    return { fonte_url: v.trim(), fonte_descricao: descricaoPadrao, data };
  }
  if (typeof v === "string" && v.trim()) {
    return { fonte_url: padrao.fonte_url, fonte_descricao: v.trim(), data };
  }
  if (isObj(v)) {
    const url = primeiro(v, ["url", "fonte_url"]);
    const desc = primeiro(v, ["descricao", "fonte_descricao"]);
    return {
      fonte_url: typeof url === "string" && url.trim() ? url.trim() : padrao.fonte_url,
      fonte_descricao: typeof desc === "string" && desc.trim() ? desc.trim() : descricaoPadrao,
      data,
    };
  }
  return { fonte_url: padrao.fonte_url, fonte_descricao: descricaoPadrao, data };
}

// ---------------------------------------------------------------------------
// Trajetória (Câmara: camara_ids · Senado: senado_codigos)
// ---------------------------------------------------------------------------

export interface TrajetoriaInsumo {
  casa: Casa;
  gerado_em: string;
  universo: number;
  /** sqcand → trajetória e os ids do parlamentar na casa (texto). */
  por_sqcand: ReadonlyMap<string, { t: TrajetoriaDerivada; ids: string[] }>;
  fonte: FonteDerivada;
}

const TRAJETORIA_CFG = {
  camara: {
    arquivo: "trajetoria-camara.json",
    campoIds: "camara_ids",
    descricao: "Câmara dos Deputados — histórico de mandatos, cruzado com a candidatura no TSE",
  },
  senado: {
    arquivo: "trajetoria-senado.json",
    campoIds: "senado_codigos",
    descricao: "Senado Federal — histórico de mandatos, cruzado com a candidatura no TSE",
  },
} as const;

export function lerTrajetoria(json: unknown, casa: Casa): Resultado<TrajetoriaInsumo> {
  const cfg = TRAJETORIA_CFG[casa];
  const pessoais = camposPessoais(json);
  if (pessoais.length > 0) {
    return {
      ok: false,
      erros: [`${cfg.arquivo} traz campo de dado pessoal: ${pessoais.slice(0, 5).join(", ")}`],
    };
  }
  if (!isObj(json)) return { ok: false, erros: [`${cfg.arquivo}: raiz não é objeto`] };
  const erros: string[] = [];
  const { gerado_em, universo, por_sqcand } = json;
  if (typeof gerado_em !== "string" || Number.isNaN(Date.parse(gerado_em))) {
    erros.push(`${cfg.arquivo}: \`gerado_em\` ausente ou inválido`);
  }
  if (typeof universo !== "number" || !Number.isInteger(universo) || universo < 0) {
    erros.push(`${cfg.arquivo}: \`universo\` deve ser inteiro ≥ 0`);
  }
  if (!isObj(por_sqcand)) erros.push(`${cfg.arquivo}: \`por_sqcand\` ausente`);
  if (erros.length > 0) return { ok: false, erros };

  const mapa = new Map<string, { t: TrajetoriaDerivada; ids: string[] }>();
  for (const [chave, v] of Object.entries(por_sqcand as Record<string, unknown>)) {
    const sq = normalizarSqcand(chave);
    if (!sq) {
      erros.push(`${cfg.arquivo}: sqcand inválido "${chave}"`);
      continue;
    }
    if (!isObj(v) || typeof v.t !== "string" || !(v.t in TRAJETORIA_PARA_VALOR)) {
      erros.push(
        `${cfg.arquivo}: ${chave} com \`t\` fora de ${Object.keys(TRAJETORIA_PARA_VALOR).join("/")}`,
      );
      continue;
    }
    const ids = v[cfg.campoIds] ?? [];
    if (!Array.isArray(ids) || ids.some((x) => !Number.isSafeInteger(x) || (x as number) <= 0)) {
      erros.push(`${cfg.arquivo}: ${chave} com \`${cfg.campoIds}\` inválido`);
      continue;
    }
    mapa.set(sq, { t: v.t as TrajetoriaDerivada, ids: (ids as number[]).map(String) });
  }
  if (erros.length > 0) return { ok: false, erros };
  const data = (gerado_em as string).slice(0, 10);
  return {
    ok: true,
    valor: {
      casa,
      gerado_em: gerado_em as string,
      universo: universo as number,
      por_sqcand: mapa,
      fonte: fonteDeclarada(json.fonte, data, casa, cfg.descricao),
    },
    avisos: [],
  };
}

// ---------------------------------------------------------------------------
// Alinhamento (votações disputadas) — Câmara: por_deputado · Senado: por_senador
// ---------------------------------------------------------------------------

export interface AlinhamentoInsumo {
  casa: Casa;
  corte: string;
  /** id do parlamentar na casa (texto) → votos disputados e taxa (0–100). */
  por_id: ReadonlyMap<string, { votos_disputadas: number; taxa_disputadas: number }>;
  fonte: FonteDerivada;
}

const ALINHAMENTO_CFG = {
  camara: {
    arquivo: "alinhamento-camara.json",
    campo: "por_deputado",
    descricao:
      "Câmara dos Deputados — votações nominais disputadas, alinhamento com a orientação do governo",
  },
  senado: {
    arquivo: "alinhamento-senado.json",
    campo: "por_senador",
    descricao:
      "Senado Federal — votações nominais disputadas, alinhamento com a orientação do governo",
  },
} as const;

export function lerAlinhamento(json: unknown, casa: Casa): Resultado<AlinhamentoInsumo> {
  const cfg = ALINHAMENTO_CFG[casa];
  const pessoais = camposPessoais(json);
  if (pessoais.length > 0) {
    return {
      ok: false,
      erros: [`${cfg.arquivo} traz campo de dado pessoal: ${pessoais.slice(0, 5).join(", ")}`],
    };
  }
  if (!isObj(json)) return { ok: false, erros: [`${cfg.arquivo}: raiz não é objeto`] };
  const erros: string[] = [];
  const { corte } = json;
  const porId = json[cfg.campo];
  if (typeof corte !== "string" || !DATA.test(corte)) {
    erros.push(`${cfg.arquivo}: \`corte\` deve ser AAAA-MM-DD`);
  } else if (casa === "camara" && corte !== ALINHAMENTO_CORTE) {
    // A metodologia publica a data de corte do catálogo; um arquivo com outro
    // corte faria a página mentir sobre a própria base. (O Senado publica o
    // próprio corte, que viaja na proveniência — `derivados.alinhamento_senado.data`.)
    erros.push(
      `${cfg.arquivo}: corte ${corte} ≠ ALINHAMENTO_CORTE (${ALINHAMENTO_CORTE}) do catálogo — ` +
        `mude os dois juntos`,
    );
  }
  if (!isObj(porId)) erros.push(`${cfg.arquivo}: \`${cfg.campo}\` ausente`);
  if (erros.length > 0) return { ok: false, erros };

  const mapa = new Map<string, { votos_disputadas: number; taxa_disputadas: number }>();
  for (const [id, v] of Object.entries(porId as Record<string, unknown>)) {
    if (!/^\d+$/.test(id)) {
      erros.push(`${cfg.arquivo}: id de parlamentar inválido "${id}"`);
      continue;
    }
    if (!isObj(v)) {
      erros.push(`${cfg.arquivo}: ${id} não é objeto`);
      continue;
    }
    const votos = v.votos_disputadas;
    const taxa = v.taxa_disputadas;
    if (typeof votos !== "number" || !Number.isInteger(votos) || votos < 0) {
      erros.push(`${cfg.arquivo}: ${id} com votos_disputadas inválido`);
      continue;
    }
    if (typeof taxa !== "number" || !Number.isFinite(taxa) || taxa < 0 || taxa > 100) {
      erros.push(`${cfg.arquivo}: ${id} com taxa_disputadas fora de [0, 100]`);
      continue;
    }
    mapa.set(String(Number(id)), { votos_disputadas: votos, taxa_disputadas: taxa });
  }
  if (erros.length > 0) return { ok: false, erros };

  // Guarda contra fração: 0,7 lido como 0,7% classificaria um governista como
  // oposição. Com volume, "tudo ≤ 1" só acontece se o arquivo veio em fração.
  const taxas = [...mapa.values()].map((x) => x.taxa_disputadas);
  if (taxas.length >= 10 && taxas.every((t) => t <= 1)) {
    return {
      ok: false,
      erros: [`${cfg.arquivo}: todas as taxas ≤ 1 — parece fração; o formato é 0–100`],
    };
  }

  return {
    ok: true,
    valor: {
      casa,
      corte: corte as string,
      por_id: mapa,
      fonte: fonteDeclarada(json.fonte, corte as string, casa, cfg.descricao),
    },
    avisos: [],
  };
}
