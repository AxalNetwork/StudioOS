/**
 * D1096 (#2961, #2408) — what the Vercel connector feeds, as the code builds it.
 *
 * ONE LIST, THREE READERS, as `githubFeeds.ts` is for GitHub. The parts that
 * write a landing set its `store`; the connector page's claims (`registry.ts`'
 * `pulls` and `feeds`) read this list through `vercelPulls` and
 * `vercelFedModules`, and `vercel_build_feeds.test.ts` holds them to it, so the
 * page never names a feed no sync writes.
 *
 * Part 1 writes no module's rows: it records the connection's installation and
 * the projects it reads (`vercel_installations`, `vercel_projects`). Each
 * landing below names the part that builds it, and stays `store: null` until
 * that part lands.
 *
 * No side effects: Build's routes import this without registering the provider.
 */
export const VERCEL_LANDINGS = [
  // Part 3 (#2963): deployments, matched to must-haves and releases by evidence only.
  { kind: 'deployment', what: 'Deployments and what is live', module: 'prototype_mvp', store: null, part: 3 },
  { kind: 'deployment', what: 'Production deploys', module: 'product_roadmap', store: null, part: 3 },
  // Part 2 (#2962): production health events, and what the product runs on.
  // D1097: health events land in `vercel_health_events`, each with its ledger row; "Runs on" reads `vercel_projects`.
  { kind: 'health_event', what: 'Production health', module: 'operating_systems', store: 'vercel_health_events', part: 2 },
  { kind: 'runtime', what: 'Framework, Node version and repository', module: 'solution_design', store: 'vercel_projects', part: 2 },
  // Part 4: where production runs, and a proposed step for a Hobby project.
  { kind: 'hosting_step', what: 'Where production runs', module: 'company_creation', store: null, part: 4 },
] as const satisfies ReadonlyArray<{ kind: string; what: string; module: string; store: string | null; part: number }>;

/**
 * The modules that read the connection itself rather than counting ledger
 * rows: Vercel is Operating systems' Hosting system, and Solution design's
 * "Runs on" reads the projects the sync recorded (D1097). A count there would
 * be a ledger zero that says nothing arrived.
 */
export const VERCEL_READ_BY = ['operating_systems', 'solution_design'] as const;

/** What "Now fed by" says for a module that reads the connection. */
export const VERCEL_READ_REASON: Record<(typeof VERCEL_READ_BY)[number], string> = {
  operating_systems: 'Read from the connection: Vercel is listed in Tools here, with its projects and each sync.',
  solution_design: 'Read from the connection: Runs on reads the framework, Node version and repository of the projects each sync records.',
};

const built = () => VERCEL_LANDINGS.filter((l) => (l.store as string | null) !== null);

/** The connector page's "It brings": only what a sync writes, and the connection itself on Operating systems. */
export function vercelPulls(): Array<{ what: string; module: string }> {
  return [
    ...built().map((l) => ({ what: l.what, module: l.module as string })),
    { what: 'The connection, its projects and each sync', module: 'operating_systems' },
  ];
}

/** Every module Vercel feeds, in the page's order: those with a store, then those reading the connection. */
export function vercelFedModules(): string[] {
  return [...new Set([...built().map((l) => l.module as string), ...VERCEL_READ_BY])];
}
