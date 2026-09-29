/**
 * app/(dep)/_interruptor.ts — o interruptor da projeção de Deputado lido NO
 * RENDER, pelas duas telas do cargo 6 (spec 026 RF-265, ADR-0063 D4).
 *
 * Um lugar só para as duas páginas, porque há dois caminhos e esquecer um é
 * o defeito: com o modo simulado ligado, a chave vem do arquivo da simulação
 * (`simulacaoInterruptorProjecao`) e NUNCA do Edge Config — a mesma regra de
 * `lib/dev/simulacao.ts` para qualquer leitura remota —, interpretada pela
 * mesma `interpretarInterruptor` que o leitor de produção usa. Sem o arquivo,
 * a chave está ausente e a projeção fica desligada (falha fechada).
 *
 * Nunca lança: `readInterruptorProjecao` já não lança, e a interpretação é pura.
 */

import { simulacaoInterruptorProjecao } from "@/lib/dev/simulacao";
import {
  type InterruptorProjecaoLido,
  interpretarInterruptor,
  readInterruptorProjecao,
} from "@/lib/edge-config/reader";

export async function lerInterruptorDaTela(emSimulacao: boolean): Promise<InterruptorProjecaoLido> {
  if (!emSimulacao) return readInterruptorProjecao();
  const valor = simulacaoInterruptorProjecao();
  return interpretarInterruptor(
    valor === undefined ? { estado: "ausente" } : { estado: "ok", valor },
  );
}
