// Registers the Oxc/TSX loader hook so `node --test` can import the
// React deck templates. See _deck-loader-hook.mjs for the details.
// D9211: also holds each test file's React act warnings to their baseline (_actWarnings.mjs).
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/spinout_demoday_deck.test.mjs
import { register } from 'node:module';
import './_actWarnings.mjs';

register(new URL('./_deck-loader-hook.mjs', import.meta.url));
