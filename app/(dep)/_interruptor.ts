/**
 * app/(dep)/_interruptor.ts — o interruptor da projeção de Deputado lido NO
 * RENDER, pelas telas dos cargos proporcionais (spec 026 RF-265, ADR-0063 D4;
 * spec 027 RF-287, ADR-0066).
 *
 * Um lugar só para todas as páginas, porque há dois caminhos e esquecer um é
 * o defeito: com o modo simulado ligado, a chave vem do arquivo da simulação
 * e NUNCA do Edge Config — a mesma regra de `lib/dev/simulacao.ts` para
 * qualquer leitura remota —, interpretada pela mesma `interpretarInterruptor`
 * que o leitor de produção usa. Sem o arquivo, a chave está ausente e a
 * projeção fica desligada (falha fechada).
 *
 * ## Uma chave por casa (spec 027)
 *
 * O federal (6) lê `interruptor-projecao-dep`; a Assembleia de cada estado (7)
 * e a Câmara Legislativa do DF (8) leem `interruptor-projecao-est` — é o
 * `readInterruptorProjecao(cargo)` da frente T que escolhe a chave pelo cargo.
 * `-dep` nunca liga 7 e 8, nem `-est` o 6 (RF-287).
 *
 * No modo simulado cada chave tem o SEU arquivo: `interruptor-projecao-dep.json`
 * para o 6 e `interruptor-projecao-est.json` para 7 e 8 (frente S). Na Fase 1
 * o gerador das assembleias não emite o segundo — chave AUSENTE, desligada.
 * Ler o do federal para 7/8 ligaria a projeção das assembleias com o
 * interruptor da Câmara, que é exatamente o cruzamento que o RF-287 proíbe.
 *
 * Nunca lança: `readInterruptorProjecao` já não lança, e a interpretação é pura.
 */

import type { CargoProporcional } from "@/lib/config/cargos";
import { simulacaoInterruptorProjecao, simulacaoInterruptorProjecaoEst } from "@/lib/dev/simulacao";
import {
  type InterruptorProjecaoLido,
  interpretarInterruptor,
  readInterruptorProjecao,
} from "@/lib/edge-config/reader";

/**
 * O valor bruto do interruptor no modo simulado, por cargo. `undefined` ⇒
 * chave ausente ⇒ desligada. Sem `default`: cargo proporcional novo sem ramo
 * é erro de compilação (`never`).
 */
function valorSimulado(cargo: CargoProporcional): unknown {
  switch (cargo) {
    case 6:
      return simulacaoInterruptorProjecao();
    case 7:
    case 8:
      // `interruptor-projecao-est` — o arquivo das assembleias, nunca o `-dep`.
      return simulacaoInterruptorProjecaoEst();
    default: {
      const naoCoberto: never = cargo;
      throw new Error(`[interruptor] cargo não coberto: ${String(naoCoberto)}`);
    }
  }
}

export async function lerInterruptorDaTela(
  cargo: CargoProporcional,
  emSimulacao: boolean,
): Promise<InterruptorProjecaoLido> {
  if (!emSimulacao) return readInterruptorProjecao(cargo);
  const valor = valorSimulado(cargo);
  return interpretarInterruptor(
    valor === undefined ? { estado: "ausente" } : { estado: "ok", valor },
  );
}
