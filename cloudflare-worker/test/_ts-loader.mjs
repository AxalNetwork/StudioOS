// Minimal ESM resolver hook that auto-appends ".ts" to bare relative
// imports when the .ts file exists on disk. Lets node --experimental-strip-types
// load worker source without touching ~30 production files just to
// add explicit ".ts" extensions (the worker uses moduleResolution=bundler
// which is happy without them).
//
// Used by cloudflare-worker/test/advisor.scenarios.test.ts via:
//   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs --test …
import { register } from 'node:module';

register(new URL('./_ts-loader-hook.mjs', import.meta.url));
