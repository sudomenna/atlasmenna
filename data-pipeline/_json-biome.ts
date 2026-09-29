// data-pipeline/_json-biome.ts
//
// Serializa JSON **já no formato que o `biome format` produz**, para um arquivo
// gerado por script entrar na árvore sem que o `biome check` do pre-commit o
// reprove (o gerador de `tests/fixtures/simulacao` precisa de um passo
// `biome format --write` depois justamente por não fazer isto).
//
// As regras são as do formatador (largura 100, indentação de 2):
//   - objeto: sempre expandido, uma chave por linha (`{}` quando vazio);
//   - lista de primitivos: numa linha só, `[1, 2, 3]` (`[]` quando vazia);
//   - lista com objeto/lista dentro: um elemento por linha.
//
// Lista de primitivos que estoure a largura **lança**: o formatador quebraria
// em "fill" (vários por linha), e emitir outra coisa reintroduziria o defeito
// que este arquivo existe para evitar. Os arquivos derivados só têm listas
// curtas de códigos; se isso mudar, o `pnpm lint` (biome check) acusa também.

const LARGURA = 100;

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function primitivo(v: Json): boolean {
  return v === null || typeof v !== "object";
}

function emitir(v: Json, nivel: number, prefixo: number): string {
  if (v === null || typeof v === "boolean" || typeof v === "number" || typeof v === "string") {
    if (typeof v === "number" && !Number.isFinite(v)) throw new Error("JSON: número não finito");
    return JSON.stringify(v);
  }
  const pad = "  ".repeat(nivel);
  const padInterno = "  ".repeat(nivel + 1);
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    if (v.every(primitivo)) {
      const inline = `[${v.map((x) => JSON.stringify(x)).join(", ")}]`;
      if (prefixo + inline.length + 1 > LARGURA) {
        throw new Error("JSON: lista de primitivos acima da largura — o formatador a quebraria");
      }
      return inline;
    }
    return `[\n${v.map((x) => `${padInterno}${emitir(x, nivel + 1, padInterno.length)}`).join(",\n")}\n${pad}]`;
  }
  const chaves = Object.keys(v);
  if (chaves.length === 0) return "{}";
  const linhas = chaves.map((k) => {
    const cabeca = `${padInterno}${JSON.stringify(k)}: `;
    return `${cabeca}${emitir(v[k] as Json, nivel + 1, cabeca.length)}`;
  });
  return `{\n${linhas.join(",\n")}\n${pad}}`;
}

/** JSON no formato do `biome format`, com quebra de linha final. */
export function jsonNoFormatoDoBiome(valor: unknown): string {
  return `${emitir(valor as Json, 0, 0)}\n`;
}
