// data-pipeline/trajetoria-camara-paridade.ts
//
// Paridade da trajetória na Câmara (spec 018, RF-214, ADR-0058) contra uma
// referência externa em CSV (`sq_candidato,…,trajetoria,ids_camara,modo`) —
// hoje `alinhamento-governo-camara/referencia_trajetoria.csv` (7.791 linhas,
// quatro categorias).
//
// ⚠️ Proveniência (ADR-0058, § "Paridade medida em 29/09/2026"): esse CSV NÃO
// é a saída do `cruzar.py` (que grava `resultado.json` com TRÊS categorias). A
// paridade daqui prova igualdade linha a linha contra ESSE arquivo; ela não é
// independência de desenho — `cruzar.py` reimplementa as mesmas três regras
// aproximadas — e a divisão `em_exercicio` × `legislatura_atual` só é tão boa
// quanto o `deputados_em_exercicio.json` dos dois lados.
//
// **Não toca banco.** Roda o MESMO cálculo da exportação offline
// (`trajetoria-camara-calculo.ts`, sobre o `_BRASIL.csv` do cache do TSE) e
// compara linha a linha `trajetoria`, `ids_camara` e `modo`. Sem
// `--camara-refresh`, a Câmara vem SÓ do cache — nunca da rede.
//
// Não imprime nome civil, data de nascimento nem nome social: a saída traz
// só `sq_candidato`, UF, nome de urna (público, é o que a tela mostra) e as
// categorias.
//
// Uso:
//   node --experimental-strip-types data-pipeline/trajetoria-camara-paridade.ts \
//     --referencia ../alinhamento-governo-camara/referencia_trajetoria.csv \
//     [--tse-dir build/tse-archives] [--camara-dir build/camara] [--camara-refresh]
//
// Exit 0 = 100% igual; 1 = alguma divergência (listada); 2 = erro de uso.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CACHE_DIR } from "./_tse-common.ts";
import { registrosCsv, TRAJETORIAS } from "./trajetoria-camara.ts";
import { calcularTrajetoriasDoCache } from "./trajetoria-camara-calculo.ts";
import { CAMARA_CACHE_DIR } from "./trajetoria-camara-fonte.ts";

interface Cli {
  referencia: string;
  tseDir: string;
  camaraDir: string;
  camaraRefresh: boolean;
}

function parseCli(argv: string[]): Cli {
  const cli: Partial<Cli> = {
    tseDir: CACHE_DIR,
    camaraDir: CAMARA_CACHE_DIR,
    camaraRefresh: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === "--camara-refresh") {
      cli.camaraRefresh = true;
      continue;
    }
    if (!v) throw new Error(`argumento sem valor ou desconhecido: ${a}`);
    if (a === "--referencia") cli.referencia = resolve(v);
    else if (a === "--tse-dir") cli.tseDir = resolve(v);
    else if (a === "--camara-dir") cli.camaraDir = resolve(v);
    else throw new Error(`argumento desconhecido: ${a}`);
    i++;
  }
  if (!cli.referencia) throw new Error("--referencia <csv> é obrigatório");
  return cli as Cli;
}

interface Linha {
  uf: string;
  nomeUrna: string;
  trajetoria: string;
  ids: string;
  modo: string;
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));

  const calc = await calcularTrajetoriasDoCache({
    tseDir: cli.tseDir,
    camaraDir: cli.camaraDir,
    camaraRefresh: cli.camaraRefresh,
  });
  const fonte = calc.camara;
  const { indice } = fonte;
  console.log(
    `[paridade] Câmara: ${indice.totalDeputados} no histórico (${indice.semNascimento} sem data), ` +
      `${indice.emExercicio.size} em exercício · deputados.csv ${fonte.deputadosTs.toISOString()} · ` +
      `em exercício ${fonte.emExercicioTs.toISOString()}`,
  );
  console.log(`[paridade] TSE: ${calc.arquivoPrincipal} (gerado ${calc.geracaoDeclarada ?? "?"})`);

  const obtido = new Map<string, Linha>();
  for (const sq of calc.universo) {
    const t = calc.porSq.get(sq);
    const c = calc.candidaturas.get(sq);
    if (!t || !c) throw new Error(`SQ ${sq} do universo sem trajetória ou sem candidatura`);
    obtido.set(sq, {
      uf: c.uf,
      nomeUrna: c.nome_urna,
      trajetoria: t.trajetoria,
      ids: (t.camaraIds ?? []).join(";"),
      modo: t.modo,
    });
  }

  const [cab, ...refLinhas] = registrosCsv(await readFile(cli.referencia, "utf8"), ",");
  if (!cab) throw new Error("referência vazia");
  const col = (n: string) => {
    const i = cab.indexOf(n);
    if (i < 0) throw new Error(`referência sem coluna ${n}`);
    return i;
  };
  const [iSq, iTraj, iIds, iModo] = ["sq_candidato", "trajetoria", "ids_camara", "modo"].map(col);
  const esperado = new Map<string, { trajetoria: string; ids: string; modo: string }>();
  for (const r of refLinhas) {
    const ids = (r[iIds as number] ?? "")
      .split(/[;, ]+/)
      .filter(Boolean)
      .map(Number)
      .sort((a, b) => a - b)
      .join(";");
    esperado.set(r[iSq as number] ?? "", {
      trajetoria: r[iTraj as number] ?? "",
      ids,
      modo: r[iModo as number] ?? "",
    });
  }

  const contar = (xs: Iterable<string>) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return TRAJETORIAS.map((t) => `${t} ${m.get(t) ?? 0}`).join(" · ");
  };
  console.log(
    `[paridade] obtido   : ${obtido.size} candidaturas · ${contar([...obtido.values()].map((l) => l.trajetoria))}`,
  );
  console.log(
    `[paridade] esperado : ${esperado.size} candidaturas · ${contar([...esperado.values()].map((l) => l.trajetoria))}`,
  );
  console.log(
    `[paridade] linhas duplicadas por SQ no CSV: ${calc.duplicadas} · ` +
      `candidaturas com >1 deputado: ${[...obtido.values()].filter((l) => l.ids.includes(";")).length}`,
  );

  const divergencias: string[] = [];
  let iguais = 0;
  for (const [sq, e] of esperado) {
    const o = obtido.get(sq);
    if (!o) {
      divergencias.push(`${sq}: ausente no obtido (esperado ${e.trajetoria})`);
      continue;
    }
    const campos: string[] = [];
    if (o.trajetoria !== e.trajetoria) campos.push(`trajetoria ${e.trajetoria} → ${o.trajetoria}`);
    if (o.ids !== e.ids) campos.push(`ids ${e.ids || "—"} → ${o.ids || "—"}`);
    if (o.modo !== e.modo) campos.push(`modo ${e.modo} → ${o.modo}`);
    if (campos.length === 0) iguais++;
    else divergencias.push(`${sq} ${o.uf} ${o.nomeUrna}: ${campos.join(" · ")}`);
  }
  for (const sq of obtido.keys()) {
    if (!esperado.has(sq)) divergencias.push(`${sq}: ausente na referência`);
  }

  console.log(`[paridade] IGUAIS: ${iguais}/${esperado.size}`);
  for (const d of divergencias) console.log(`  ≠ ${d}`);
  process.exit(divergencias.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[paridade] falha:", err instanceof Error ? err.message : err);
  process.exit(2);
});
