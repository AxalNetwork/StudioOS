/**
 * D5608 — the tracer's off-thread module hooks. A synchronous
 * `module.registerHooks` resolve hook in the test process changed what
 * frontend tests loaded through `_deck-loader.mjs`'s async hooks rendered
 * (data_room_d696 test 11 failed with the tracer on, even with a hook that
 * only passed every call through), so the tracer registers this async hook
 * instead. It reports each resolved repo module to the test process over a
 * MessagePort and sends `node:sqlite` through `test-tracer-sqlite.mjs`.
 */
const SHIM = new URL('./test-tracer-sqlite.mjs', import.meta.url).href;
let port = null;

export function initialize(data) {
  port = data?.port ?? null;
}

export async function resolve(specifier, context, next) {
  if ((specifier === 'node:sqlite' || specifier === 'sqlite') && context.parentURL !== SHIM) {
    const result = await next(specifier, context);
    if (result.url === 'node:sqlite') return { url: SHIM, shortCircuit: true };
    return result;
  }
  const result = await next(specifier, context);
  if (result.url?.startsWith('file:') && !result.url.includes('/node_modules/')) {
    try { port?.postMessage(result.url); } catch { /* Trace output is advisory. */ }
  }
  return result;
}
