// data-pipeline/senado-parse.ts
//
// **Leitura tipada das respostas do Senado Federal — Dados Abertos.** Puro: recebe
// o JSON já lido (do cache ou da rede) e devolve estruturas enxutas, ou lança com
// o caminho do campo que não bateu. Fail-fast: uma resposta com o formato
// mudado tem de derrubar o ciclo, não produzir zero votos em silêncio.
//
// Cada esquema declara **só o que o pipeline consome**. O `z.object` do Zod
// descarta o resto, e isso é deliberado: a resposta de `/votacao` traz o nome
// de cada senador e a de `/senador/{codigo}` traz endereço, e-mail e telefone —
// nada disso chega às estruturas em memória. (A data de nascimento e o nome
// civil chegam, e só por `parseDetalhe`: é o insumo do casamento em memória
// do ADR-0062 item 5.)
//
// O Senado converte XML em JSON, então um campo repetido vem como **lista**
// quando há vários e como **objeto solto** quando há um só (`Mandato`,
// `Parlamentar`, `Exercicio`). `umOuMais` normaliza os dois.

import { z } from "zod";

const DataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data fora de AAAA-MM-DD");

function umOuMais<T extends z.ZodType>(schema: T) {
  return z
    .union([schema, z.array(schema)])
    .nullish()
    .transform((v): z.output<T>[] => (v == null ? [] : Array.isArray(v) ? v : [v]));
}

// ---------------------------------------------------------------------------
// Votações nominais (`GET /votacao?dataInicio=&dataFim=`)
// ---------------------------------------------------------------------------

const VotoSchema = z.object({
  codigoParlamentar: z.number().int(),
  siglaPartidoParlamentar: z.string().nullish(),
  siglaVotoParlamentar: z.string().nullish(),
});

const VotacaoNominalSchema = z.object({
  /** Chave de junção com as orientações. Nula em algumas votações abertas. */
  sequencialVotacao: z.number().int().nullish(),
  codigoSessaoVotacao: z.number().int().nullish(),
  dataSessao: DataIso,
  casaSessao: z.string().nullish(),
  /** `"S"` — voto secreto: a lista traz só "Votou"; `"N"` — voto aberto. */
  votacaoSecreta: z.enum(["S", "N"]),
  identificacao: z.string().nullish(),
  votos: z
    .array(VotoSchema)
    .nullish()
    .transform((v) => v ?? []),
});

export type VotoIndividual = z.output<typeof VotoSchema>;
export type VotacaoNominal = z.output<typeof VotacaoNominalSchema>;

// ---------------------------------------------------------------------------
// Orientação de bancada (`GET /plenario/votacao/orientacaoBancada/{ini}/{fim}`)
// ---------------------------------------------------------------------------

const OrientacaoLiderancaSchema = z.object({
  partido: z.string(),
  voto: z.string().nullish(),
});

const VotacaoComOrientacaoSchema = z.object({
  sequencialVotacao: z.number().int().nullish(),
  orientacoesLideranca: z
    .array(OrientacaoLiderancaSchema)
    .nullish()
    .transform((v) => v ?? []),
});

const RespostaOrientacoesSchema = z.union([
  z.object({
    votacoes: z
      .array(VotacaoComOrientacaoSchema)
      .nullish()
      .transform((v) => v ?? []),
  }),
  // Janela sem votações: o serviço pode devolver lista vazia em vez de objeto.
  z
    .array(z.never())
    .transform(() => ({ votacoes: [] as z.output<typeof VotacaoComOrientacaoSchema>[] })),
]);

export type OrientacaoLideranca = z.output<typeof OrientacaoLiderancaSchema>;
export type VotacaoComOrientacao = z.output<typeof VotacaoComOrientacaoSchema>;

// ---------------------------------------------------------------------------
// Parlamentares
// ---------------------------------------------------------------------------

const LegislaturaSchema = z.object({
  NumeroLegislatura: z.coerce.number().int(),
  DataInicio: DataIso,
  DataFim: DataIso,
});

const MandatoSchema = z.object({
  UfParlamentar: z.string().nullish(),
  PrimeiraLegislaturaDoMandato: LegislaturaSchema,
  SegundaLegislaturaDoMandato: LegislaturaSchema.nullish(),
  DescricaoParticipacao: z.string().nullish(),
});

const IdentificacaoSchema = z.object({
  CodigoParlamentar: z.coerce.number().int(),
  NomeParlamentar: z.string(),
  NomeCompletoParlamentar: z.string().nullish(),
  SiglaPartidoParlamentar: z.string().nullish(),
  UfParlamentar: z.string().nullish(),
});

export interface MandatoSenado {
  uf: string | null;
  /** Início da 1ª legislatura do mandato. */
  inicio: string;
  /** Fim da última legislatura do mandato: `2027-01-31` (eleito em 2018) ou `2031-01-31` (2022). */
  fim: string;
  /** `Titular`, `1º Suplente`, `2º Suplente`. */
  participacao: string | null;
}

export interface ParlamentarSenado {
  codigo: number;
  nomeParlamentar: string;
  /** `NomeCompletoParlamentar` — nome civil. Só em memória; nunca sai em arquivo. */
  nomeCivil: string | null;
  partido: string | null;
  uf: string | null;
  mandatos: MandatoSenado[];
}

/** Fim do mandato cujas cadeiras estão em disputa em 2026. */
export const FIM_MANDATO_EM_DISPUTA = "2027-01-31";
/** Fim do mandato dos 27 eleitos em 2022, que continuam. */
export const FIM_MANDATO_QUE_CONTINUA = "2031-01-31";

export type Cadeira = "2027" | "2031";

/** A cadeira a que um mandato pertence, pelo fim dele. Outra data → `null`. */
export function cadeiraDoFim(fim: string): Cadeira | null {
  if (fim === FIM_MANDATO_EM_DISPUTA) return "2027";
  if (fim === FIM_MANDATO_QUE_CONTINUA) return "2031";
  return null;
}

function mandatoNormalizado(m: z.output<typeof MandatoSchema>): MandatoSenado {
  const ultima = m.SegundaLegislaturaDoMandato ?? m.PrimeiraLegislaturaDoMandato;
  return {
    uf: m.UfParlamentar ?? null,
    inicio: m.PrimeiraLegislaturaDoMandato.DataInicio,
    fim: ultima.DataFim,
    participacao: m.DescricaoParticipacao ?? null,
  };
}

function parlamentar(
  id: z.output<typeof IdentificacaoSchema>,
  mandatos: z.output<typeof MandatoSchema>[],
): ParlamentarSenado {
  return {
    codigo: id.CodigoParlamentar,
    nomeParlamentar: id.NomeParlamentar,
    nomeCivil: id.NomeCompletoParlamentar?.trim() || null,
    partido: id.SiglaPartidoParlamentar?.trim() || null,
    uf: id.UfParlamentar ?? mandatos[0]?.UfParlamentar ?? null,
    mandatos: mandatos.map(mandatoNormalizado),
  };
}

// `Mandato` é objeto em `lista/atual` e `afastados`, e lista dentro de `Mandatos` na
// listagem por legislatura.
const ItemAtualSchema = z.object({
  IdentificacaoParlamentar: IdentificacaoSchema,
  Mandato: MandatoSchema,
});

const ItemLegislaturaSchema = z.object({
  IdentificacaoParlamentar: IdentificacaoSchema,
  Mandatos: z
    .object({ Mandato: umOuMais(MandatoSchema) })
    .nullish()
    .transform((v) => v?.Mandato ?? []),
});

const ListaAtualSchema = z.object({
  ListaParlamentarEmExercicio: z.object({
    Parlamentares: z.object({ Parlamentar: umOuMais(ItemAtualSchema) }),
  }),
});

const AfastadosSchema = z.object({
  AfastamentoAtual: z.object({
    Parlamentares: z
      .object({ Parlamentar: umOuMais(ItemAtualSchema) })
      .nullish()
      .transform((v) => v?.Parlamentar ?? []),
  }),
});

const ListaLegislaturaSchema = z.object({
  ListaParlamentarLegislatura: z.object({
    Parlamentares: z.object({ Parlamentar: umOuMais(ItemLegislaturaSchema) }),
  }),
});

const DetalheSchema = z.object({
  DetalheParlamentar: z.object({
    Parlamentar: z.object({
      IdentificacaoParlamentar: IdentificacaoSchema,
      DadosBasicosParlamentar: z
        .object({ DataNascimento: DataIso.nullish() })
        .nullish()
        .transform((v) => v ?? {}),
    }),
  }),
});

function analisar<T extends z.ZodType>(schema: T, json: unknown, contexto: string): z.output<T> {
  const r = schema.safeParse(json);
  if (r.success) return r.data;
  const detalhe = r.error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`)
    .join("; ");
  throw new Error(`Senado — resposta de ${contexto} fora do formato esperado (${detalhe})`);
}

/** `GET /votacao` → votações nominais (abertas e secretas) da janela. */
export function parseVotacoes(json: unknown): VotacaoNominal[] {
  return analisar(z.array(VotacaoNominalSchema), json, "votações");
}

/** `GET /plenario/votacao/orientacaoBancada/...` → votações com as orientações das bancadas. */
export function parseOrientacoes(json: unknown): VotacaoComOrientacao[] {
  return analisar(RespostaOrientacoesSchema, json, "orientações de bancada").votacoes;
}

/** `GET /senador/lista/atual` — os 81 em exercício hoje. */
export function parseListaAtual(json: unknown): ParlamentarSenado[] {
  return analisar(
    ListaAtualSchema,
    json,
    "senadores em exercício",
  ).ListaParlamentarEmExercicio.Parlamentares.Parlamentar.map((p) =>
    parlamentar(p.IdentificacaoParlamentar, [p.Mandato]),
  );
}

/** `GET /senador/afastados` — fora de exercício (titulares e suplentes), com o mandato. */
export function parseAfastados(json: unknown): ParlamentarSenado[] {
  return analisar(AfastadosSchema, json, "senadores afastados").AfastamentoAtual.Parlamentares.map(
    (p) => parlamentar(p.IdentificacaoParlamentar, [p.Mandato]),
  );
}

/** `GET /senador/lista/legislatura/{n}?exercicio=S` — quem exerceu mandato na legislatura. */
export function parseListaLegislatura(json: unknown): ParlamentarSenado[] {
  return analisar(
    ListaLegislaturaSchema,
    json,
    "senadores da legislatura",
  ).ListaParlamentarLegislatura.Parlamentares.Parlamentar.map((p) =>
    parlamentar(p.IdentificacaoParlamentar, p.Mandatos),
  );
}

export interface DetalheSenador {
  codigo: number;
  nomeParlamentar: string;
  nomeCivil: string | null;
  /** AAAA-MM-DD; `null` quando o Senado não informa. Só em memória. */
  nascimento: string | null;
}

/** `GET /senador/{codigo}` — nome civil e nascimento, insumo do casamento em memória. */
export function parseDetalhe(json: unknown): DetalheSenador {
  const p = analisar(DetalheSchema, json, "detalhe de senador").DetalheParlamentar.Parlamentar;
  return {
    codigo: p.IdentificacaoParlamentar.CodigoParlamentar,
    nomeParlamentar: p.IdentificacaoParlamentar.NomeParlamentar,
    nomeCivil: p.IdentificacaoParlamentar.NomeCompletoParlamentar?.trim() || null,
    nascimento: p.DadosBasicosParlamentar.DataNascimento ?? null,
  };
}
