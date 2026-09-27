/**
 * components/layout/Footer.tsx
 *
 * Footer constitucional § 1 — "Não oficial. Fonte: TSE." precisa estar
 * em TODAS as páginas da SalaCofre.
 *
 * Server Component puro. Minimal por design — o spec-implementer da spec
 * 003 (home) ou um shared agent pode evoluir com mais links (sobre o
 * modelo, dados abertos, etc.).
 */

import Link from "next/link";

export function Footer() {
  return (
    <footer
      className="mt-12 border-t px-5 py-6 text-center text-sm"
      style={{
        borderColor: "var(--color-border)",
        color: "var(--color-text-muted)",
      }}
    >
      <p>
        Não oficial. Fonte:{" "}
        <a
          href="https://resultados.tse.jus.br"
          rel="noopener noreferrer"
          target="_blank"
          style={{ color: "var(--color-text)", textDecoration: "underline" }}
        >
          TSE
        </a>
        . AtlasMenna 2026.
      </p>
      {/*
        `/candidatos` (spec 018, T-13) entra AQUI e não no `<CargoTabs>`: o
        próprio `CargoTabs.tsx` registra que "Deputado Federal" já não cabe em
        1/4 de 430px, e uma quinta coluna quebraria a barra em todos os
        breakpoints. É rota de nível superior, como `/sobre-o-modelo` — e o
        footer é a única entrada global que não custa pixel acima da dobra.
      */}
      <p className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs">
        <Link href="/candidatos" style={{ color: "var(--color-text-muted)" }}>
          Candidatos
        </Link>
        <Link href="/sobre-o-modelo" style={{ color: "var(--color-text-muted)" }}>
          Sobre o modelo
        </Link>
      </p>
    </footer>
  );
}
