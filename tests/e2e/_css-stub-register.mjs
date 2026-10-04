// Registra `_css-stub-loader.mjs` — passado ao `tsx` com `--import` pelo
// `serie-apuracao-a11y.spec.ts`. Ver o cabeçalho do loader.
import { register } from "node:module";

register("./_css-stub-loader.mjs", import.meta.url);
