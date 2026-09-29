/**
 * tests/unit/data-pipeline/senado-mandatos-snapshot.test.ts — spec 023,
 * RF-215; ADR-0062 item 1.
 *
 * O recorte `tests/fixtures/senado/lista-atual.recorte.json` é a resposta real
 * de `senador/lista/atual.json` de 29/09/2026 04h47 UTC, reduzida aos campos que
 * a foto lê — com o nome civil e o e-mail TROCADOS por marcadores, para provar
 * que a lista branca os descarta sem guardar dado real nenhum no repositório.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  buscarLista,
  ESPERA_MINIMA_MS,
  esperaDe,
  gravarFotos,
  jsonDaFoto,
  montarFotos,
  parseCli,
  participacaoDe,
  TENTATIVAS,
  URL_LISTA_ATUAL,
} from "@/data-pipeline/senado-mandatos-snapshot";
import recorte from "@/tests/fixtures/senado/lista-atual.recorte.json" with { type: "json" };

const CONSULTADO_EM = "2026-09-29T04:47:02Z";
const RAIZ = path.resolve(__dirname, "../../..");

type Resposta = {
  ListaParlamentarEmExercicio: {
    Parlamentares: { Parlamentar: Array<Record<string, Record<string, unknown>>> };
  };
};
const copia = () => structuredClone(recorte) as unknown as Resposta;

describe("montarFotos — a resposta do Senado vira as duas fotos", () => {
  const r = montarFotos(copia(), CONSULTADO_EM);

  it("aceita a resposta de 29/09: 27 até 2031, 54 até 2027", () => {
    expect(r.ok ? [] : r.erros).toEqual([]);
    if (!r.ok) return;
    expect(r.fotos.mandato2031.senadores).toHaveLength(27);
    expect(r.fotos.mandato2027.senadores).toHaveLength(54);
  });

  // 🔴 Teste de deriva: a foto versionada é EXATAMENTE o que o script produz
  // do recorte versionado — byte a byte, formatação incluída (o hook de
  // pre-commit roda `biome check` e reprovaria um JSON fora da forma).
  it("reproduz byte a byte os arquivos de editorial/senado/", () => {
    if (!r.ok) throw new Error("recusada");
    for (const [nome, foto] of [
      ["mandato-2031.json", r.fotos.mandato2031],
      ["mandato-2027.json", r.fotos.mandato2027],
    ] as const) {
      expect(jsonDaFoto(foto), nome).toBe(
        readFileSync(path.join(RAIZ, "editorial/senado", nome), "utf8"),
      );
    }
  });

  it("lista branca: o nome civil e o e-mail do recorte NÃO chegam à foto", () => {
    if (!r.ok) throw new Error("recusada");
    const texto = JSON.stringify(r.fotos);
    expect(texto).not.toContain("NOME CIVIL");
    expect(texto).not.toContain("nao-gravar@");
    expect(Object.keys(r.fotos.mandato2031.senadores[0] ?? {}).sort()).toEqual(
      [
        "codigo",
        "codigo_mandato",
        "legislaturas",
        "nome_parlamentar",
        "participacao",
        "partido",
        "uf",
      ].sort(),
    );
  });

  it("suplente em exercício leva o titular; o senador sem partido fica 'S/Partido'", () => {
    if (!r.ok) throw new Error("recusada");
    const s = r.fotos.mandato2031.senadores;
    expect(s.find((x) => x.uf === "MA")).toMatchObject({
      participacao: "Suplente em exercício",
      titular_do_mandato: "Flávio Dino",
      partido: "PSB",
    });
    expect(s.find((x) => x.uf === "RJ")?.partido).toBe("S/Partido");
  });

  it("a versão do dado e a fonte vão para a foto; a data é a da consulta, não a de agora", () => {
    if (!r.ok) throw new Error("recusada");
    expect(r.fotos.mandato2031).toMatchObject({
      fonte: "Senado Federal — Dados Abertos",
      fonte_url: URL_LISTA_ATUAL,
      consultado_em: CONSULTADO_EM,
      versao_dataset: "29/09/2026 01:46:55",
    });
  });

  // 🔴 Tudo ou nada: uma cadeira a menos e NENHUMA das duas fotos sai.
  it("um senador de 2031 a menos ⇒ recusa, e diz qual UF ficou sem", () => {
    const resp = copia();
    const lista = resp.ListaParlamentarEmExercicio.Parlamentares.Parlamentar;
    const i = lista.findIndex(
      (p) =>
        (p.IdentificacaoParlamentar as { UfParlamentar: string }).UfParlamentar === "AC" &&
        (p.Mandato as { SegundaLegislaturaDoMandato: { NumeroLegislatura: string } })
          .SegundaLegislaturaDoMandato.NumeroLegislatura === "58",
    );
    lista.splice(i, 1);
    const falha = montarFotos(resp, CONSULTADO_EM);
    expect(falha.ok).toBe(false);
    if (falha.ok) return;
    expect(falha.erros.join("\n")).toContain("mandato-2031: UF AC aparece 0 vez");
  });

  it("partido fora da paleta ⇒ recusa", () => {
    const resp = copia();
    const p0 = resp.ListaParlamentarEmExercicio.Parlamentares.Parlamentar[0];
    (p0?.IdentificacaoParlamentar as Record<string, unknown>).SiglaPartidoParlamentar = "PODEMOS";
    expect(montarFotos(resp, CONSULTADO_EM).ok).toBe(false);
  });

  it("resposta fora da forma ⇒ recusa, sem lançar", () => {
    expect(montarFotos({ outra: "coisa" }, CONSULTADO_EM).ok).toBe(false);
  });
});

describe("participacaoDe", () => {
  it("Titular, 1º e 2º suplente; outra coisa é desconhecida", () => {
    expect(participacaoDe("Titular")).toBe("Titular");
    expect(participacaoDe("1º Suplente")).toBe("Suplente em exercício");
    expect(participacaoDe("2º Suplente")).toBe("Suplente em exercício");
    expect(participacaoDe("Efetivo")).toBeNull();
  });
});

function resposta(status: number, corpo: unknown = {}, retryAfter?: string): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: retryAfter ? { "retry-after": retryAfter } : {},
  });
}

describe("buscarLista — a API do Senado responde 503 com frequência", () => {
  it("503, 503, 200 ⇒ devolve a resposta, esperando o retry-after (mínimo 15 s)", async () => {
    const buscar = vi
      .fn()
      .mockResolvedValueOnce(resposta(503, {}, "15"))
      .mockResolvedValueOnce(resposta(503, {}, "20"))
      .mockResolvedValueOnce(resposta(200, { ok: 1 }));
    const esperar = vi.fn(async (_ms: number) => {});
    await expect(buscarLista(buscar, esperar, TENTATIVAS, () => {})).resolves.toEqual({ ok: 1 });
    expect(buscar).toHaveBeenCalledTimes(3);
    expect(esperar.mock.calls.map((c) => c[0])).toEqual([15_000, 20_000]);
    expect(buscar.mock.calls[0]?.[0]).toBe(URL_LISTA_ATUAL);
    expect(buscar.mock.calls[0]?.[1]).toMatchObject({ headers: { Accept: "application/json" } });
  });

  it("404 ⇒ erro definitivo, sem nova tentativa", async () => {
    const buscar = vi.fn().mockResolvedValue(resposta(404));
    const esperar = vi.fn(async (_ms: number) => {});
    await expect(buscarLista(buscar, esperar, TENTATIVAS, () => {})).rejects.toThrow(/404/);
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(esperar).not.toHaveBeenCalled();
  });

  it(`erro de rede em todas ⇒ desiste depois de ${TENTATIVAS} tentativas`, async () => {
    const buscar = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const esperar = vi.fn(async (_ms: number) => {});
    await expect(buscarLista(buscar, esperar, TENTATIVAS, () => {})).rejects.toThrow(
      /8 tentativas sem resposta \(ECONNRESET\)/,
    );
    expect(buscar).toHaveBeenCalledTimes(TENTATIVAS);
    expect(esperar).toHaveBeenCalledTimes(TENTATIVAS - 1);
  });

  it("retry-after ausente, inválido ou curto demais ⇒ 15 s", () => {
    expect(esperaDe(null)).toBe(ESPERA_MINIMA_MS);
    expect(esperaDe("abc")).toBe(ESPERA_MINIMA_MS);
    expect(esperaDe("2")).toBe(ESPERA_MINIMA_MS);
    expect(esperaDe("30")).toBe(30_000);
  });
});

describe("gravarFotos e CLI", () => {
  it("grava as duas fotos na pasta pedida, sem deixar temporário", () => {
    const r = montarFotos(copia(), CONSULTADO_EM);
    if (!r.ok) throw new Error("recusada");
    const dir = mkdtempSync(path.join(tmpdir(), "senado-foto-"));
    try {
      const gravados = gravarFotos(r.fotos, dir);
      expect(gravados.map((g) => path.basename(g))).toEqual([
        "mandato-2031.json",
        "mandato-2027.json",
      ]);
      expect(readFileSync(gravados[0] as string, "utf8")).toBe(jsonDaFoto(r.fotos.mandato2031));
      expect(() => readFileSync(`${gravados[0]}.tmp`)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--de-arquivo sem --consultado-em é recusado: a data da foto não pode ser 'agora'", () => {
    expect(() => parseCli(["--de-arquivo", "x.json"])).toThrow(/consultado-em/);
    expect(parseCli(["--de-arquivo", "x.json", "--consultado-em", CONSULTADO_EM])).toMatchObject({
      deArquivo: "x.json",
      consultadoEm: CONSULTADO_EM,
      saida: "editorial/senado",
      seco: false,
    });
    expect(parseCli(["--seco"]).seco).toBe(true);
    expect(() => parseCli(["--qualquer"])).toThrow(/desconhecido/);
  });
});
