import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Default node; testes de componentes podem sobrescrever via // @vitest-environment happy-dom
    environment: "node",
    // 🔴 Rede de segurança do incidente de 2026-09-14: a suíte nunca publica
    // num destino real. Ver `tests/setup/no-remote-writes.ts` — é o arquivo
    // que explica por que esta linha existe, e ele deve ser lido antes de
    // qualquer tentativa de removê-la.
    setupFiles: ["./tests/setup/no-remote-writes.ts", "./tests/setup/modo-ao-vivo.ts"],
    include: [
      "tests/unit/**/*.{test,spec}.{ts,tsx}",
      "tests/integration/**/*.{test,spec}.{ts,tsx}",
    ],
    globals: false,
    // F0.6 (S04) — Anti-flaky em tests integration. `ingest-cycle.test.ts`
    // (spec 001 shipped) espera count absoluto de `ingest_log`; em forks
    // paralelos outros integration tests inserem linhas e o assert quebra.
    // Vitest 4 removeu `poolOptions.forks.singleFork` (migration guide:
    // https://vitest.dev/guide/migration#pool-rework). Substituto correto:
    // `fileParallelism: false` serializa execução de test files.
    // Combinado com `.toBeGreaterThanOrEqual` em ingest-cycle:T19 (relaxado
    // do `.toBe` original) cobre o flaky. Carry-over #9 retro S03.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
