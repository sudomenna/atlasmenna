/**
 * tests/unit/painel/acesso.test.ts
 *
 * As funções puras da senha do painel (`lib/painel/acesso.ts`, ADR-0077).
 * O comportamento ponta a ponta no `proxy.ts` está em
 * `tests/unit/proxy/proxy-painel.test.ts`.
 */

import { describe, expect, it } from "vitest";

import { ehRotaDoPainel, painelAutorizado, senhaDoBasicAuth } from "@/lib/painel/acesso";
import { segredoConfere } from "@/lib/utils/segredo";

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

describe("ehRotaDoPainel", () => {
  it.each([
    "/painel",
    "/painel/",
    "/painel/x",
    "/painel.rsc",
    "/painel.segments/painel/__PAGE__.segment.rsc",
    "/_next/data/abc123/painel.json",
  ])("%s é o painel", (c) => {
    expect(ehRotaDoPainel(c)).toBe(true);
  });

  it.each([
    "/",
    "/painelzinho",
    "/api/painel",
    "/x/painel",
    "/painel-publico",
  ])("%s NÃO é o painel", (c) => {
    expect(ehRotaDoPainel(c)).toBe(false);
  });
});

describe("senhaDoBasicAuth", () => {
  it("devolve o que vem depois do PRIMEIRO dois-pontos (a senha pode ter ':')", () => {
    expect(senhaDoBasicAuth(`Basic ${b64("dono:a:b:c")}`)).toBe("a:b:c");
    expect(senhaDoBasicAuth(`basic ${b64(":só-senha")}`)).toBe("só-senha");
  });

  it("rejeita esquema errado, base64 inválido e credencial sem ':'", () => {
    expect(senhaDoBasicAuth(null)).toBeNull();
    expect(senhaDoBasicAuth(`Bearer ${b64("x:y")}`)).toBeNull();
    expect(senhaDoBasicAuth("Basic !!!")).toBeNull();
    expect(senhaDoBasicAuth(`Basic ${b64("semdoispontos")}`)).toBeNull();
  });
});

describe("painelAutorizado", () => {
  it("fail-closed: senha esperada ausente ou vazia nunca autoriza", () => {
    const h = `Basic ${b64("x:")}`;
    expect(painelAutorizado(h, undefined)).toBe(false);
    expect(painelAutorizado(h, "")).toBe(false);
  });

  it("autoriza só a senha idêntica", () => {
    expect(painelAutorizado(`Basic ${b64("x:certa")}`, "certa")).toBe(true);
    expect(painelAutorizado(`Basic ${b64("x:Certa")}`, "certa")).toBe(false);
    expect(painelAutorizado(`Basic ${b64("certa:")}`, "certa")).toBe(false);
  });
});

describe("segredoConfere (movido do proxy.ts)", () => {
  it("ausência de qualquer lado é false; só igualdade exata é true", () => {
    expect(segredoConfere(null, "a")).toBe(false);
    expect(segredoConfere("a", undefined)).toBe(false);
    expect(segredoConfere("", "")).toBe(false);
    expect(segredoConfere("abc", "abd")).toBe(false);
    expect(segredoConfere("abc", "abc")).toBe(true);
  });
});
