/**
 * lib/state/store-por-pagina.ts
 *
 * **Uma instância de store por PÁGINA, não por cópia de módulo.**
 *
 * ## O problema que isto remove
 *
 * Uma store Zustand de módulo (`export const useX = create(...)`) é única
 * enquanto o módulo for avaliado uma vez. Essa premissa não é do nosso código
 * — é do empacotador. Basta o módulo ser avaliado duas vezes na mesma página
 * para existirem **duas stores independentes**: quem escreve escreve numa,
 * quem lê lê a outra, ninguém lança erro, nada aparece no console, e o sintoma
 * é exatamente "o evento acontece e a outra ponta não reage".
 *
 * O risco é concreto onde produtor e consumidor caem em lados opostos de um
 * `next/dynamic({ ssr: false })` (ADR-0010): o módulo entra **inteiro** nos
 * dois pacotes. Medido no build de 2026-09-20 desta árvore: `hover-store.ts`
 * aparece com corpo próprio em **5** chunks de `.next/static/chunks`, e dois
 * deles são carregados juntos na home `/` — o da `<StateGroupedTable>` (quem
 * escreve, via `<UfHoverLink>`) e o de `_NationalChoroplethMapImpl` (quem lê).
 *
 * ⚠️ **Hoje, nesta versão do Turbopack, a duplicação de bytes NÃO vira
 * duplicação de instância**: o runtime registra as fábricas num `Map` global
 * chaveado por id de módulo e ignora a segunda inscrição
 * (`installCompressedModuleFactories`: `if (!moduleFactories.has(id))`), e o id
 * é o mesmo nos dois chunks. Ou seja: esta função **não é o conserto de um
 * defeito medido** — é a remoção de uma dependência silenciosa. O que hoje
 * garante instância única é um detalhe interno do empacotador, que ninguém
 * neste repositório escolheu, ninguém testa e que muda sem aviso numa
 * atualização do Next. Os caminhos que ainda duplicam de verdade:
 *
 *   - **HMR em desenvolvimento** — `applyPhase` faz
 *     `moduleFactories.set(id, factory)` **sem guarda** e reinstancia; um
 *     módulo de store reavaliado nasce zerado e desalinhado de quem já o
 *     segurava;
 *   - **reavaliação em teste** (`vi.resetModules()`), que é o que os testes
 *     desta função usam para reproduzir o cenário de propósito;
 *   - **ids divergentes** — mesma fonte compilada em camadas/contextos
 *     diferentes, ou alcançada por dois caminhos de resolução distintos.
 *
 * ## Por que `Symbol.for`, e não um módulo "de registro"
 *
 * Um módulo de registro teria o mesmo problema que está tentando resolver: se
 * o empacotador duplica um módulo, duplica esse também. `Symbol.for(chave)`
 * não depende de módulo nenhum — resolve no **registro global de símbolos do
 * runtime**, que é um só para toda a página. Somado a `globalThis` (um único
 * objeto por documento), a segunda avaliação de qualquer cópia do módulo
 * reencontra o que a primeira criou, em vez de criar outro.
 *
 * 🔴 **Não troque `Symbol.for(...)` por `Symbol(...)`.** Um símbolo novo a
 * cada avaliação devolve exatamente o defeito original com cara de proteção:
 * duas cópias, duas chaves, duas stores.
 *
 * ## 🔴 No SERVIDOR isto NÃO registra nada — de propósito
 *
 * Estes módulos também são avaliados no render de servidor, e lá `globalThis`
 * é **compartilhado entre requisições de pessoas diferentes**. Pendurar estado
 * de UI ali é, por construção, vazamento de uma visita para outra.
 *
 * Hoje nenhuma escrita acontece durante o SSR (todas vêm de evento de ponteiro
 * ou de foco, que só existem no navegador), então cada avaliação de servidor
 * criar a sua é inofensivo: a store nasce no default, ninguém a muda, e o
 * cliente hidrata por cima. Mas **não construímos em cima dessa suposição** —
 * ela é verdadeira por acidente do que os componentes fazem hoje, e uma futura
 * escrita no servidor viraria contaminação entre requisições sem sintoma
 * local. O caminho seguro é o registro existir só no navegador; o custo de
 * estar errado nas duas direções é assimétrico (no cliente, uma store a mais;
 * no servidor, dado de uma pessoa aparecendo para outra).
 *
 * O teste que trava esta decisão é `tests/unit/state/store-por-pagina.servidor.test.ts`.
 */

/**
 * Chave do registro no `globalThis`. `Symbol.for` (registro global de
 * símbolos), nunca `Symbol()` — ver o § acima. A string leva o nome do projeto
 * para não colidir com nada que a plataforma ou uma dependência penduram lá.
 */
const CHAVE_REGISTRO = Symbol.for("atlasmenna/state/registro-de-stores");

type ComRegistro = Record<symbol, Map<string, unknown> | undefined>;

/**
 * Devolve a store de `chave`, criando-a na primeira vez e reencontrando-a em
 * toda avaliação seguinte do módulo — **no navegador**. No servidor, sempre
 * cria uma nova (ver o § "No SERVIDOR" no topo).
 *
 * @param chave Identidade estável da store. Use o caminho do módulo que a
 *   declara: é único por construção e sobrevive a renomeação de variável.
 * @param criar Fábrica da store. Chamada no máximo uma vez por página.
 */
export function storeUnicaPorPagina<T>(chave: string, criar: () => T): T {
  if (typeof window === "undefined") return criar();

  const global = globalThis as unknown as ComRegistro;
  let registro = global[CHAVE_REGISTRO];
  if (registro === undefined) {
    registro = new Map<string, unknown>();
    global[CHAVE_REGISTRO] = registro;
  }

  // `has`, não `get() !== undefined`: uma store cujo valor legítimo fosse
  // `undefined` seria recriada a cada avaliação — a mesma família do "default
  // silencioso" que o ADR-0038 D1 proíbe no payload.
  if (registro.has(chave)) return registro.get(chave) as T;

  const store = criar();
  registro.set(chave, store);
  return store;
}

/**
 * Só para testes: esvazia o registro. Sem isto, um caso que prova "duas
 * avaliações, uma store" deixa a store viva para o caso seguinte.
 */
export function __limparRegistroDeStoresParaTestes(): void {
  (globalThis as unknown as ComRegistro)[CHAVE_REGISTRO] = undefined;
}
