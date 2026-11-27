/**
 * #4105 — route modules that mount themselves.
 *
 * WHY. `index.ts` changed in 63 of 403 commits on `main` in one week, because
 * every new router added an import and an `app.route(...)` line to it. A route
 * module may now say where it mounts instead, with a `mount` export:
 *
 *   export const mount: RouteMount = { path: '/api/widgets', router: widgets };
 *   export const mount: RouteMount[] = [
 *     { path: '/api/decks', router: deckReports, before: [decks] },
 *     { path: '/api/admin/deck-reports', router: hqDeckReports, before: [decks] },
 *   ];
 *
 * `scripts/build-route-registry.mjs` finds every module with a `mount` export
 * and writes `routes/_registry.ts` (generated, committed, checked for
 * staleness by `test/route_registry_4105.test.ts`), which `index.ts` hands to
 * `attachRouteRegistry` right after it creates the app. Workers cannot list a
 * folder at runtime, so the list is generated; the ORDER is decided here, at
 * startup, by `planMounts`.
 *
 * WHERE A REGISTERED ROUTER MOUNTS — the contract.
 *   - With no `before`, or a `before` that names only other registered
 *     routers, it mounts in the registry's slot: `mountRemaining()`, which
 *     `index.ts` calls after its last `app.route(...)` and before
 *     `app.notFound`. That is exactly where a hand-written mount appended to the
 *     end of the route table sat: after every middleware `app.use(...)`, after
 *     every legacy router (so any `use('*')` a legacy router registers on a
 *     covering prefix wraps it, as it wraps every router mounted after it),
 *     and before the 404.
 *   - `before: [r, …]` names routers this one must be mounted AHEAD of, by
 *     reference (import the router). If `r` is still mounted by a hand-written
 *     `app.route(...)` in `index.ts` (a "legacy" mount), this router is mounted
 *     immediately before that line's first mount of `r` — as if the line had
 *     been written by hand just above it. If `r` is registered, it simply
 *     mounts first.
 *   - Ties keep file-name order, then the order of the module's own array.
 *
 * HOW THE LEGACY HOOK WORKS. `attachRouteRegistry` shadows `app.route` on this
 * one app instance until `mountRemaining()` restores it. Every hand-written
 * `app.route(path, r)` first mounts the registered routers whose `before`
 * names `r`, then `r`. Nothing else in `index.ts` changes, so its 390 mounts
 * and the tests that read them by text are untouched.
 *
 * `before` is read when the module is loaded, so a module cannot name a router
 * whose file (transitively) imports it back: the binding would not exist yet
 * and the Worker fails to start, which every test importing `index.ts` sees.
 */
import type { Hono } from 'hono';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRouter = Hono<any, any, any>;

/** Where one router mounts. `path` is the full path, e.g. `/api/decks`. */
export interface RouteMount {
  path: string;
  router: AnyRouter;
  /** Routers this one must be mounted ahead of: registered or legacy-mounted. */
  before?: readonly AnyRouter[];
}

/** One entry of the generated `routes/_registry.ts`: a module and its `mount` export. */
export interface RegisteredModule {
  file: string;
  mount: RouteMount | readonly RouteMount[];
}

/** One router to mount, flattened out of its module. */
export interface PlannedMount {
  file: string;
  index: number;
  path: string;
  router: AnyRouter;
  before: readonly AnyRouter[];
}

/**
 * Every registered mount in the order the slot mounts them: a router named in
 * another's `before` comes after it, and a module's own array keeps its order;
 * otherwise file-name order.
 * A cycle cannot be planned: it throws, naming the files (the generator
 * refuses one first, so this is the backstop).
 */
export function planMounts(modules: readonly RegisteredModule[]): PlannedMount[] {
  const flat: PlannedMount[] = [];
  const sorted = [...modules].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  for (const m of sorted) {
    const list = Array.isArray(m.mount) ? m.mount : [m.mount as RouteMount];
    list.forEach((d, index) => flat.push({ file: m.file, index, path: d.path, router: d.router, before: d.before ?? [] }));
  }
  // Kahn's algorithm, always taking the earliest ready entry, so the order is
  // the file order wherever `before` does not say otherwise.
  const preds = new Map<PlannedMount, Set<PlannedMount>>(flat.map((e) => [e, new Set()]));
  // A module's own array is an order too: entry i mounts before entry i + 1.
  flat.forEach((e, i) => { if (e.index > 0) preds.get(e)!.add(flat[i - 1]); });
  for (const a of flat) {
    for (const b of flat) {
      if (a !== b && a.before.includes(b.router)) preds.get(b)!.add(a);
    }
  }
  const out: PlannedMount[] = [];
  const left = [...flat];
  while (left.length) {
    const at = left.findIndex((e) => [...preds.get(e)!].every((p) => out.includes(p)));
    if (at < 0) throw new Error(`route registry: \`before\` forms a cycle among ${left.map((e) => `${e.file}[${e.index}]`).join(', ')}`);
    out.push(left.splice(at, 1)[0]);
  }
  return out;
}

/** What actually mounted, in order: `file` is set for a registered router. */
export interface MountRecord {
  path: string;
  router: AnyRouter;
  file?: string;
}

export interface AttachedRegistry {
  /** Mounts every registered router not yet mounted, and restores `app.route`. */
  mountRemaining(): void;
  /** Every mount made through `app.route` since attaching, in order. */
  readonly mounted: readonly MountRecord[];
}

/**
 * Hooks the registry into `app`: call it before the first `app.route(...)`,
 * and call `mountRemaining()` after the last one.
 */
export function attachRouteRegistry(app: AnyRouter, modules: readonly RegisteredModule[]): AttachedRegistry {
  const plan = planMounts(modules);
  const route = app.route; // Hono's own method; the shadow below calls it
  const own = Object.prototype.hasOwnProperty.call(app, 'route');
  const done = new Set<PlannedMount>();
  const busy = new Set<PlannedMount>();
  const mounted: MountRecord[] = [];

  const mountOne = (e: PlannedMount): void => {
    if (done.has(e) || busy.has(e)) return;
    busy.add(e);
    // Whatever must precede it goes first.
    for (const p of plan) if (!done.has(p) && p.before.includes(e.router)) mountOne(p);
    busy.delete(e);
    done.add(e);
    route.call(app, e.path, e.router);
    mounted.push({ path: e.path, router: e.router, file: e.file });
  };

  const shadow = function (this: unknown, path: string, sub: AnyRouter) {
    for (const p of plan) if (!done.has(p) && p.before.includes(sub)) mountOne(p);
    route.call(app, path, sub);
    mounted.push({ path, router: sub });
    return app;
  };
  (app as unknown as { route: unknown }).route = shadow;

  return {
    mountRemaining() {
      if (own) (app as unknown as { route: unknown }).route = route;
      else delete (app as unknown as { route?: unknown }).route;
      for (const e of plan) mountOne(e);
    },
    mounted,
  };
}
