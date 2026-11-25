/**
 * D8528 (#8528) — a D1 binding that holds two (or more) requests at their first
 * write until every one of them has finished its reads, then lets those writes
 * through one at a time in a chosen order.
 *
 * Production D1 can interleave two requests the same way: each reads the state
 * it decides on, then writes. A route whose write does not re-check what it
 * read (`WHERE status = 'pending'`, the change count read back) can then act on
 * a state that no longer holds. Run one after the other, such a race never
 * shows; under this barrier it does, in both orders.
 *
 *   const { DB, race } = barrierOver(d1Over(db));
 *   const [a, b] = await race(['accept', 'revoke'], [() => call(...), () => call(...)]);
 *
 * `race(order, fns)` runs each fn under its tag (the order's entries, matched to
 * `fns` by position) and releases the held first writes in `order`: the first
 * tag's write completes before the second is let go. A request that ends without
 * writing (refused on its reads) counts as arrived, so the others never hang.
 *
 * A write is `run()`, `all()` or `first()` on an INSERT, UPDATE, DELETE or
 * REPLACE statement, or a `batch()`. Writes after a request's first one, and
 * every read, pass straight through. Only tagged requests are held.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const WRITE = /^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i;

type Round = { order: string[]; arrived: Map<string, (() => void) | null>; written: Map<string, Promise<void>>; done: Set<string>; released: boolean };

export function barrierOver(inner: any) {
  const tagOf = new AsyncLocalStorage<string>();
  let round: Round | null = null;

  async function release(r: Round) {
    r.released = true;
    for (const tag of r.order) {
      const go = r.arrived.get(tag);
      if (!go) continue; // that request ended without writing
      go();
      await r.written.get(tag);
    }
  }

  /** Holds the caller's first write until every tag has arrived; returns the hook to call once it is written. */
  async function hold(): Promise<() => void> {
    const r = round;
    const tag = tagOf.getStore();
    if (!r || tag == null || !r.order.includes(tag) || r.done.has(tag)) return () => {};
    r.done.add(tag);
    let wrote!: () => void;
    r.written.set(tag, new Promise<void>((res) => { wrote = res; }));
    await new Promise<void>((go) => {
      r.arrived.set(tag, go);
      if (r.arrived.size === r.order.length && !r.released) void release(r);
    });
    return wrote;
  }

  /** A request that ended without writing is arrived for the others' sake. */
  function leave(tag: string) {
    const r = round;
    if (!r || r.arrived.has(tag)) return;
    r.done.add(tag);
    r.arrived.set(tag, null);
    if (r.arrived.size === r.order.length && !r.released) void release(r);
  }

  const gated = (fn: () => Promise<any>) => async () => {
    const wrote = await hold();
    try { return await fn(); } finally { wrote(); }
  };

  const DB = {
    prepare(sql: string) {
      const st = inner.prepare(sql);
      const write = WRITE.test(sql);
      const api: any = {
        bind(...a: unknown[]) { st.bind(...a); return api; },
        run: () => (write ? gated(() => st.run())() : st.run()),
        all: () => (write ? gated(() => st.all())() : st.all()),
        first: (col?: string) => (write ? gated(() => st.first(col))() : st.first(col)),
        runSync: () => st.runSync(),
      };
      return api;
    },
    batch: (stmts: any[]) => gated(() => inner.batch(stmts))(),
    exec: (sql: string) => inner.exec(sql),
  };

  /** Runs `fns` concurrently, each under its tag, holding their first writes and releasing them in `order`. */
  async function race<T extends unknown[]>(order: string[], fns: { [K in keyof T]: () => Promise<T[K]> }, tags: string[] = order): Promise<T> {
    if (new Set(order).size !== order.length || tags.length !== fns.length || [...tags].sort().join() !== [...order].sort().join()) {
      throw new Error('race: order and tags must name each request once');
    }
    round = { order, arrived: new Map(), written: new Map(), done: new Set(), released: false };
    try {
      return await Promise.all(fns.map((fn, i) => tagOf.run(tags[i], async () => {
        try { return await fn(); } finally { leave(tags[i]); }
      }))) as T;
    } finally {
      round = null;
    }
  }

  return { DB, race };
}
