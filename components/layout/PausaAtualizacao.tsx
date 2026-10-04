"use client";

/**
 * components/layout/PausaAtualizacao.tsx
 *
 * O controle "Pausar / Retomar" da atualização automática, numa linha do
 * `<Footer>`. É a exigência da WCAG 2.2.2 (Pausar, parar, ocultar — nível A,
 * constituição § 4) para conteúdo que se atualiza sozinho: quem lê devagar, ou
 * com leitor de tela, precisa poder congelar a página.
 *
 * Ilha cliente mínima: o `<Footer>` continua Server Component. Lê e grava o
 * mesmo estado de `<AtualizacaoAutomatica>` (`atualizacao-estado.ts`); o aviso
 * entre os dois é um `CustomEvent`, porque o evento `storage` não chega à aba
 * que escreveu.
 *
 * ## Hidratação
 *
 * O servidor não conhece a preferência (mora em `localStorage`), então o HTML
 * sai sempre no estado "se atualiza a cada minuto · Pausar" — o
 * `getServerSnapshot` do `useSyncExternalStore`. O cliente hidrata com esse
 * mesmo valor e só DEPOIS lê o storage e corrige o texto, num render normal —
 * não há divergência de hidratação, só um tick com o rótulo do default (o
 * mesmo arranjo do `<ThemeToggle>`).
 *
 * ## Quando não aparece
 *
 * Nas rotas que não se atualizam (`/candidatos`, `/sobre-*`) e com
 * `saveData` — prometer "se atualiza a cada minuto" onde nada se atualiza
 * seria falso.
 */

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

import {
  assinarPausa,
  economiaDeDados,
  gravarPausada,
  lerPausada,
  rotaComAtualizacao,
} from "./atualizacao-estado";

const nuncaMuda = () => () => {};
const falso = () => false;

export function PausaAtualizacao() {
  const pathname = usePathname();
  const pausada = useSyncExternalStore(assinarPausa, lerPausada, falso);
  const economia = useSyncExternalStore(nuncaMuda, economiaDeDados, falso);

  if (!rotaComAtualizacao(pathname) || economia) return null;

  return (
    <p className="mt-2 text-xs" data-testid="atualizacao-automatica">
      {pausada ? "Atualização pausada" : "Esta página se atualiza a cada minuto"}
      {" · "}
      <button
        type="button"
        data-testid="atualizacao-pausar"
        // O nome acessível começa pelo rótulo visível (WCAG 2.5.3) e diz O QUÊ
        // pausa — "Pausar" sozinho, lido fora da frase, não diz.
        aria-label={
          pausada ? "Retomar a atualização automática" : "Pausar a atualização automática"
        }
        onClick={() => gravarPausada(!pausada)}
        style={{
          color: "var(--color-text)",
          textDecoration: "underline",
          background: "none",
          border: 0,
          padding: "4px 2px",
          font: "inherit",
          cursor: "pointer",
        }}
      >
        {pausada ? "Retomar" : "Pausar"}
      </button>
    </p>
  );
}
