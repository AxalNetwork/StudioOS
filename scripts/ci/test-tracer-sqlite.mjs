/**
 * D5608 — `node:sqlite` as the tracer's hooks hand it to a traced test: the
 * same module, with `DatabaseSync` recording each file database it opens.
 */
import sqlite, { DatabaseSync as Original } from 'node:sqlite';

const record = globalThis[Symbol.for('studioos.testTracer.sqlite')];
export const DatabaseSync = typeof record !== 'function' ? Original : new Proxy(Original, {
  construct(target, args, newTarget) {
    try { if (args[0] !== ':memory:') record(args[0]); } catch { /* Trace output is advisory. */ }
    return Reflect.construct(target, args, newTarget);
  },
});
export * from 'node:sqlite';
export default { ...sqlite, DatabaseSync };
