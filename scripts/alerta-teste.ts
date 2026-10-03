/**
 * scripts/alerta-teste.ts
 *
 * Manda **um** alarme de teste pelo canal configurado e diz se chegou.
 *
 * Uso:
 *   set -a; . ./.env.local; set +a
 *   pnpm alerta:teste
 *   pnpm alerta:teste "texto livre da mensagem"
 *
 * ---------------------------------------------------------------------------
 * Por que este script existe
 * ---------------------------------------------------------------------------
 * O `Definition of Done` da sprint S08 pede **captura da mensagem recebida, com
 * hora** — e o runbook § "Testes manuais de alerting" descreve o teste sem
 * oferecer um jeito de fazê-lo. Sem isto, a única forma de exercitar o canal
 * seria forçar um erro no pipeline.
 *
 * ⛔ **E forçar erro contra o CDN do TSE é proibido neste projeto** (ADR-0020):
 * uma requisição malformada pode bloquear o IP por **10 minutos**, o limiar não
 * é divulgado, e restam pouquíssimas janelas antes de 04/10. Este script **não
 * fala com o TSE** — nem com o mock, nem com o CDN. Ele chama `notifySlack`
 * diretamente, que é exatamente o mesmo caminho que os 10 pontos de alarme do
 * pipeline usam.
 *
 * ---------------------------------------------------------------------------
 * O que ele prova, e o que não prova
 * ---------------------------------------------------------------------------
 * **Prova**: que a variável está no ambiente, que o endereço aceita o POST, e
 * que a mensagem chega com o formato que o pipeline emite.
 *
 * **Não prova** que os alarmes disparam nas condições certas — isso é
 * `tests/unit/tse/alerts.test.ts` (13 casos), e é outra pergunta.
 */

import { notifySlack } from "../lib/tse/alerts";

async function main(): Promise<void> {
  const textoLivre = process.argv.slice(2).join(" ").trim();
  const agora = new Date();
  const carimbo = agora.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  if (!process.env.SLACK_WEBHOOK_URL) {
    console.error("");
    console.error("🔴 SLACK_WEBHOOK_URL não está no ambiente — nada foi enviado.");
    console.error("");
    console.error("   Se você já colou na Vercel, ela ainda não está AQUI: o");
    console.error("   `.env.local` é separado. Duas saídas:");
    console.error("");
    console.error("     vercel env pull .env.local     # traz do ambiente development");
    console.error("     # ou cole a linha à mão no .env.local e recarregue:");
    console.error("     set -a; . ./.env.local; set +a");
    console.error("");
    process.exit(1);
  }

  const msg =
    textoLivre ||
    `teste de canal — se você está lendo isto, o alarme do AtlasMenna funciona (${carimbo})`;

  console.log(`[alerta-teste] enviando… (${carimbo})`);
  await notifySlack({
    severity: "warn",
    msg,
    ctx: {
      origem: "pnpm alerta:teste",
      enviado_em: agora.toISOString(),
      observacao: "mensagem de teste — nenhum problema real no pipeline",
    },
  });

  console.log("");
  console.log("[alerta-teste] POST concluído sem erro.");
  console.log("");
  console.log("🔴 Isto NÃO é prova de entrega. `notifySlack` é fire-and-forget:");
  console.log("   ele nunca lança, de propósito — um alarme que derruba o ciclo");
  console.log("   que observa é pior que um alarme mudo. Um endereço revogado");
  console.log("   sai exatamente como um endereço bom.");
  console.log("");
  console.log("   ➜ Confirme NO CANAL que a mensagem chegou, e anote a hora.");
  console.log("     É o que o Definition of Done da S08 pede.");
}

void main();
