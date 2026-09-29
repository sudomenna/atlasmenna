/**
 * tests/fixtures/hemiciclo/casos-camara.ts — os casos do RETRATO de
 * `<CamaraHemiciclo>` (spec 023, T4).
 *
 * Spec 023 extraiu a pintura do plenário para `components/blocks/Hemiciclo.tsx`
 * e fez de `<CamaraHemiciclo>` uma casca. A exigência era a saída **idêntica
 * byte a byte** à de antes da extração. O retrato (`camara-retrato.json`) foi
 * gerado com o código de `a791e6d` — ANTES de qualquer linha da extração — e
 * `tests/unit/components/camara-hemiciclo-retrato.test.tsx` compara a saída de
 * hoje contra ele.
 *
 * Os casos cobrem cada ramo do componente antigo: os três estados, o singular
 * e o plural das duas frases da legenda, o extremo pequeno da geometria
 * (arcos < 12), o `null` sem cadeira, as props de moldura (`descritoPorId`,
 * `idPrefixo`, `className`, `style`) e a fixture do simulado.
 *
 * 🔴 NÃO regenere o JSON a partir do código novo: aí ele passa a retratar a
 * extração, e o teste deixa de provar qualquer coisa.
 */

import type { CamaraHemicicloProps } from "@/components/blocks/CamaraHemiciclo";
import type { EdgeAgremiacaoBancada, EdgeBancadaNacional } from "@/lib/edge-config/types";
// 🔴 A bancada do simulado CONGELADA em 27/09 — a que existia quando o retrato
// foi gerado (`a791e6d`). Até 29/09 este arquivo lia `simulacao/deputado.json`
// ao vivo; a spec 026 regenerou o simulado (RR a 100%, válidos sem anulados),
// a bancada mudou, e o caso "simulado" passaria a comparar o código com um
// retrato de OUTRO dado. O retrato prova "o código não mudou"; para isso a
// entrada também não pode mudar.
import bancadaSimuladoCongelada from "@/tests/fixtures/hemiciclo/bancada-simulado-27set.json" with {
  type: "json",
};

function agr(over: Partial<EdgeAgremiacaoBancada> = {}): EdgeAgremiacaoBancada {
  return {
    cod: "22",
    sigla: "PL",
    nome: "Partido Liberal",
    tipo: "partido",
    componentes: [],
    sigla_lider: "PL",
    cadeiras: 40,
    votos_nominais: 1,
    votos_legenda: 1,
    votos_validos: 2,
    pct_votos: 1,
    ...over,
  };
}

function bancada120(over: Partial<EdgeBancadaNacional> = {}): EdgeBancadaNacional {
  return {
    total_cadeiras: 120,
    cadeiras_atribuidas: 100,
    ufs_calculadas: 20,
    ufs_aguardando: 7,
    por_agremiacao: [
      agr({ cod: "22", sigla: "PL", sigla_lider: "PL", cadeiras: 60 }),
      agr({
        cod: "13",
        sigla: "FE BRASIL",
        nome: "Federação Brasil da Esperança",
        tipo: "federacao",
        componentes: ["PT", "PCdoB", "PV"],
        sigla_lider: "PT",
        cadeiras: 40,
        cadeiras_indefinidas: 7,
      }),
    ],
    ...over,
  };
}

const bancadaSim = bancadaSimuladoCongelada as unknown as EdgeBancadaNacional;

export function casosRetratoCamara(): Record<string, CamaraHemicicloProps> {
  return {
    simulado: { bancada: bancadaSim },
    simulado_531: { bancada: { ...bancadaSim, total_cadeiras: 531 } },
    tres_estados_com_moldura: {
      bancada: bancada120(),
      descritoPorId: "lista-agremiacoes",
      idPrefixo: "plenario-x",
      className: "classe-x",
      style: { maxWidth: "40rem" },
    },
    tudo_por_apurar: {
      bancada: bancada120({ total_cadeiras: 77, cadeiras_atribuidas: 0, por_agremiacao: [] }),
    },
    singulares: {
      bancada: bancada120({
        total_cadeiras: 42,
        por_agremiacao: [
          agr({ cod: "50", sigla: "PSOL", sigla_lider: "PSOL", cadeiras: 20 }),
          agr({
            cod: "15",
            sigla: "MDB",
            sigla_lider: "MDB",
            cadeiras: 20,
            cadeiras_indefinidas: 1,
          }),
        ],
      }),
    },
    indefinidas_em_excesso: {
      bancada: bancada120({
        total_cadeiras: 10,
        por_agremiacao: [agr({ cadeiras: 10, cadeiras_indefinidas: 99 })],
      }),
    },
    extremo_pequeno_4: {
      bancada: bancada120({
        total_cadeiras: 4,
        por_agremiacao: [agr({ cadeiras: 3 })],
      }),
    },
    extremo_pequeno_17: {
      bancada: bancada120({
        total_cadeiras: 17,
        por_agremiacao: [
          agr({ cod: "10", sigla: "REPUBLICANOS", sigla_lider: "REPUBLICANOS", cadeiras: 9 }),
          agr({ cod: "40", sigla: "PSB", sigla_lider: "PSB", cadeiras: 5 }),
        ],
      }),
    },
    empate_por_sigla: {
      bancada: bancada120({
        total_cadeiras: 30,
        por_agremiacao: [
          agr({ cod: "1", sigla: "ZZZ", sigla_lider: "ZZZ", cadeiras: 15 }),
          agr({ cod: "2", sigla: "AAA", sigla_lider: "AAA", cadeiras: 15 }),
        ],
      }),
    },
    sem_cadeira: {
      bancada: bancada120({ total_cadeiras: 0, por_agremiacao: [] }),
    },
  };
}
