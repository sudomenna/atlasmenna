import type { Metadata } from "next";
import { Archivo, JetBrains_Mono, Spectral } from "next/font/google";
import { ThemeToggle } from "@/components/atoms/controls/ThemeToggle";
import { CargoTabs } from "@/components/layout/CargoTabs";
import { ShellControls } from "@/components/layout/ShellControls";
import { ShellLiveBadge } from "@/components/layout/ShellLiveBadge";
import { TopBar } from "@/components/layout/TopBar";
import { currentPresidentialTurno } from "@/lib/config/calendar";
import { THEME_INIT_SCRIPT } from "@/lib/state/theme";
import { VIEW_MODE_DEFAULT } from "@/lib/state/view-mode";
import "./globals.css";

// Design system Atlas Menna (ADR-0025 § 4): Spectral no display editorial,
// Archivo no corpo, JetBrains Mono nos números. As variáveis saem com sufixo
// `-src` e são remapeadas em `@theme inline` (app/globals.css) — sem o sufixo,
// a variável que o Tailwind declara colide com a classe que o next/font injeta
// no <html>. Tokens em docs/design-system/tokens.md.
const serifDisplay = Spectral({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-serif-src",
  display: "swap",
});

const sans = Archivo({
  subsets: ["latin"],
  variable: "--font-sans-src",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-src",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AtlasMenna — Apuração eleitoral 2026",
  description:
    "Plataforma pública de apuração eleitoral 2026 com projeção estatística. Não oficial. Fonte: TSE.",
};

/**
 * Shell global (ADR-0025 § 2, recomposto pelo ADR-0029).
 *
 * Ordem no documento:
 *   `<TopBar>`  wordmark + subtítulo (turno do calendário) + `<ShellLiveBadge>`
 *     └── `<ShellControls>`  — 2ª linha da barra:
 *          ├── `<CargoTabs placement="top">`  — só ≥960px (ADR-0029 § 3)
 *          └── turno · parcial/projeção       — (ADR-0029 § 2)
 *   `{children}`                          — `<main data-trilha>` + `<Footer>`
 *   `<CargoTabs placement="bottom">`      — só <960px, barra fixa no rodapé
 *
 * O que este layout deliberadamente NÃO faz:
 *   - não lê `cookies()`, `headers()` nem `searchParams` — qualquer um deles
 *     tornaria dinâmicas as 54 páginas de UF hoje pré-renderizadas estáticas
 *     (ADR-0025 § 2 e § 5). Vale também para os dois controles novos: o
 *     seletor de turno sai de `currentPresidentialTurno()` (função pura do calendário,
 *     ADR-0012) e o "Parcial / Projeção" é estado de cliente espelhado em
 *     `data-view` no `<html>` — nenhum dos dois passa por requisição;
 *   - não lê Edge Config. O percentual do `<ShellLiveBadge>` chega por
 *     custom property publicada pela página (ver `ShellLiveBadge.tsx`), não
 *     por uma leitura de dado no layout, que tiraria tudo do estático;
 *   - não hospeda `<Footer>` nem `main[data-trilha]`. Os dois seguem de posse
 *     de cada página (ADR-0025 § 1), e os testes de integração verificam o
 *     `<Footer>` DENTRO do `<main>`.
 *
 * `data-view` no `<html>` é o valor inicial do controle "Parcial / Projeção":
 * escrito no servidor para que o primeiro paint já saia na base certa, sem
 * flash e sem depender de hidratação. Precisa casar com `VIEW_MODE_DEFAULT`
 * — por isso vem da constante, não de um literal.
 *
 * O JS de aplicação que este shell acrescenta são DOIS componentes client:
 * `<ViewModeSwitch>` dentro de `<ShellControls>` e `<ThemeToggle>` no slot
 * direito da barra. `TopBar`, `CargoTabs`, `TabBar`, `TurnoSwitch` e
 * `ShellLiveBadge` continuam RSC puros.
 *
 * ## O tema, e por que ele começa por um `<script>` cru (ADR-0025 § 5)
 *
 * A preferência de tema mora em `localStorage` — nunca em cookie, que exigiria
 * `cookies()` aqui e tiraria as 54 páginas de UF do pré-render estático. Só que
 * `localStorage` não existe no servidor: o HTML sai sem `data-theme`, ou seja,
 * claro. Aplicar a preferência na hidratação faria toda página começar branca e
 * escurecer depois.
 *
 * `THEME_INIT_SCRIPT` (`lib/state/theme.ts`) resolve isso: inline, síncrono, o
 * primeiro nó do `<body>`, ele lê `localStorage` — caindo para
 * `prefers-color-scheme` quando não há escolha salva — e escreve `data-theme`
 * no `<html>` **antes do primeiro paint**. Daí para baixo é cascata CSS.
 *
 * O `<html>` NÃO renderiza `data-theme` (ao contrário de `data-view`): o
 * servidor não conhece a preferência, e escrever um valor ali só para o script
 * sobrescrever criaria divergência de hidratação de verdade. `data-theme` é
 * propriedade do script e da store, nunca do React — daí o
 * `suppressHydrationWarning`, que cobre exatamente esse atributo a mais.
 *
 * O wordmark não é `<h1>`: cada página emite o seu.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const turno = currentPresidentialTurno();

  return (
    <html
      lang="pt-BR"
      data-view={VIEW_MODE_DEFAULT}
      className={`${sans.variable} ${serifDisplay.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: conteúdo é uma
            constante do repositório (lib/state/theme.ts), sem dado de usuário —
            e precisa ser inline e síncrono para rodar antes do primeiro paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <TopBar
          brand="AtlasMenna"
          brandHref="/"
          subtitle={`Eleições 2026 · ${turno}º turno · não oficial`}
          right={
            <>
              <ShellLiveBadge />
              <ThemeToggle />
            </>
          }
        >
          <ShellControls cargoNav={<CargoTabs placement="top" />} />
        </TopBar>
        {children}
        <CargoTabs placement="bottom" />
      </body>
    </html>
  );
}
