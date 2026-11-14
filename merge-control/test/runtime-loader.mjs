/** Node test adapter only: replace the runtime base class, keeping the real controller and SQLite. */
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx=ctx; this.env=env; } }', shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
// D5620: stands in for `wrangler deploy --define MERGE_CONTROL_POLICY_VERSION:...`; tests that need it unset delete it.
globalThis.MERGE_CONTROL_POLICY_VERSION ??= 'f'.repeat(40);
