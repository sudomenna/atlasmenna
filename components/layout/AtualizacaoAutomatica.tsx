"use client";

/**
 * components/layout/AtualizacaoAutomatica.tsx
 *
 * Atualiza a página sozinha a cada minuto (04/10/2026, decisão do dono:
 * "atualização automática para todos os visitantes").
 *
 * ## O problema
 *
 * Até aqui só o mapa se atualizava (`<PersistentMapFrame>`, 60 s). Placar,
 * listas de deputados, corte e marcas ficavam congelados no que o servidor
 * entregou no carregamento — numa tela de apuração deixada aberta (o telão do
 * dia D), os números envelheciam até alguém apertar F5.
 *
 * ## Como
 *
 * `router.refresh()` do App Router: pede ao servidor o payload RSC da rota
 * atual e reconcilia no lugar, sem recarregar a página — estado de cliente
 * (lista aberta, base "Parcial / Projeção", rolagem, foco) sobrevive. As
 * páginas de apuração são dinâmicas em produção (`cache-control: no-store`),
 * então cada refresh traz o dado mais recente do Edge Config.
 *
 * ## Quando NÃO roda
 *
 *   - fora das rotas de apuração (`ROTAS_COM_ATUALIZACAO`);
 *   - com a aba oculta — e não gera carga nenhuma enquanto oculta: o timer é
 *     cancelado. Ao voltar a aba, se já passou o intervalo desde a última
 *     atualização, atualiza na hora;
 *   - com a pausa ligada no rodapé (`<PausaAtualizacao>`, WCAG 2.2.2);
 *   - com `navigator.connection.saveData` (o visitante pediu economia).
 *
 * ## Por que `setTimeout` encadeado, e não `setInterval`
 *
 * Cada espera sorteia um atraso novo (0–15 s): as abas abertas no mesmo
 * segundo se espalham em vez de bater no servidor juntas a cada minuto.
 *
 * ## Por que não lê `useSearchParams`
 *
 * Num Client Component do shell, `useSearchParams` faz o Next desistir do
 * pré-render até o `<Suspense>` mais próximo — que, no layout, é a página
 * inteira. A guarda é o caso (a) de `tests/unit/shell/static-shell.test.ts`.
 *
 * É o TERCEIRO Client Component do shell (caso (e) do mesmo teste), e custa
 * pouco: não renderiza nada, e `next/navigation` e React já estão no bundle.
 */

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import {
  ATUALIZACAO_INTERVALO_MS,
  ATUALIZACAO_JITTER_MS,
  assinarPausa,
  economiaDeDados,
  lerPausada,
  rotaComAtualizacao,
} from "./atualizacao-estado";

export function AtualizacaoAutomatica() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!rotaComAtualizacao(pathname)) return;
    if (economiaDeDados()) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    // A página acabou de chegar do servidor (carga ou navegação): conta como
    // atualizada agora.
    let ultima = Date.now();

    const visivel = () => document.visibilityState === "visible";
    const podeRodar = () => visivel() && !lerPausada();

    const cancelar = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };

    const atualizar = () => {
      ultima = Date.now();
      router.refresh();
    };

    const agendar = () => {
      cancelar();
      if (!podeRodar()) return;
      const espera = ATUALIZACAO_INTERVALO_MS + Math.floor(Math.random() * ATUALIZACAO_JITTER_MS);
      timer = setTimeout(() => {
        timer = null;
        if (!podeRodar()) return;
        // Sem rede, o `router.refresh()` do Next 16 cai numa navegação de
        // documento (fetch RSC falho → `location` na URL) e troca o placar pela
        // tela de erro do navegador. Pular a volta mantém o último dado na tela
        // (constituição § 7); a próxima tenta de novo.
        if (navigator.onLine !== false) atualizar();
        agendar();
      }, espera);
    };

    /**
     * Aba voltou a ficar visível, ou a pausa foi retomada: se o dado na tela
     * já tem mais de um intervalo, atualiza na hora; depois reagenda. Aba
     * oculta ou pausa ligada: só cancela.
     */
    const sincronizar = () => {
      if (!podeRodar()) {
        cancelar();
        return;
      }
      if (Date.now() - ultima > ATUALIZACAO_INTERVALO_MS && navigator.onLine !== false) atualizar();
      agendar();
    };

    document.addEventListener("visibilitychange", sincronizar);
    const desassinar = assinarPausa(sincronizar);
    agendar();

    return () => {
      cancelar();
      document.removeEventListener("visibilitychange", sincronizar);
      desassinar();
    };
  }, [pathname, router]);

  return null;
}
