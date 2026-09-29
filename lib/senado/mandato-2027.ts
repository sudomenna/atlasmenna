/**
 * lib/senado/mandato-2027.ts — a foto dos 54 senadores que ocupam HOJE as
 * vagas em disputa em 2026 (`editorial/senado/mandato-2027.json`, spec 023,
 * ADR-0062 item 1). Usada só pela visão de renovação (spec 025, RF-249): é o
 * "de quem era a cadeira" contra o qual a troca de PARTIDO é contada.
 *
 * Módulo separado de `mandato-2031.ts` de propósito: quem não precisa dos 54
 * (o hemiciclo de 81, a página inteira de `/senador` sem a V4) não carrega o
 * arquivo. Mesmo validador, mesma recusa sem exceção — arquivo inválido vira
 * `{ ok: false }` e a visão não é desenhada.
 */

import dados2027 from "@/editorial/senado/mandato-2027.json" with { type: "json" };

import { type ValidacaoFotoSenado, validarMandato2027 } from "./mandato-2031";

export const MANDATO_2027: ValidacaoFotoSenado = validarMandato2027(dados2027);
