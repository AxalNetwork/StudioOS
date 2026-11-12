/** Node test adapter only: replace the runtime base class, keeping the real controller and SQLite. */
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx=ctx; this.env=env; } }', shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
