// Registers the Oxc/TSX loader hook so `node --test` can import the
// React deck templates. See _deck-loader-hook.mjs for the details.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/spinout_demoday_deck.test.mjs
//
// From frontend/test/README.md (moved by #6472): `_deck-loader.mjs` is the JSX/asset loader; every
// run needs `--import` on it.
import { register } from 'node:module';

register(new URL('./_deck-loader-hook.mjs', import.meta.url));
