import { MODULE_LABELS } from './moduleLabels';

/**
 * D782 (#2113) — what the GitHub connector feeds, as the code builds it.
 *
 * ONE LIST, THREE READERS. The sync (`providers/github.ts`) writes the
 * landings below, Operating systems' sync lines name them, and the connector
 * page's claims (`registry.ts`' `pulls` and `feeds`, `connectorPages.ts`) are
 * held to them by `github_code_system_d782.test.ts`, so the page never names a
 * feed the sync does not write. A D782 part that adds a feed adds it here.
 *
 * No side effects: the Build cycle route imports this without registering the
 * provider.
 */

/**
 * One entry per kind a sync reads. `count` is the sync's figure for that kind;
 * `store` is the table its rows land in, or null when the module has no store
 * for it yet and the item is only counted. `ledger: false` marks a kind that
 * writes onto another kind's rows instead of making its own (a milestone sets
 * its items' group and target), so it has no ledger rows to count.
 */
export const GITHUB_LANDINGS = [
  { kind: 'issue', count: 'issues', one: 'issue', many: 'issues', what: 'Issues', module: 'product_roadmap', store: 'roadmap_okrs' },
  { kind: 'pull_request', count: 'pull_requests', one: 'pull request', many: 'pull requests', what: 'Pull requests', module: 'prototype_mvp', store: 'mvp_features' },
  // D782 (#2111): a release is a row in Product roadmap, and marks the items it shipped.
  { kind: 'release', count: 'releases', one: 'release', many: 'releases', what: 'Releases', module: 'product_roadmap', store: 'roadmap_releases' },
  // D782 (#2111): a milestone gives its issues' items their group and target.
  { kind: 'milestone', count: 'milestones', one: 'milestone', many: 'milestones', what: 'Milestones', module: 'product_roadmap', store: 'roadmap_okrs', ledger: false },
] as const;

/** The modules that read the connection itself rather than ledger rows: GitHub is Operating systems' Code system. */
export const GITHUB_READ_BY = ['operating_systems'] as const;

/** Every module GitHub feeds, in the page's order: those with a store, then those reading the connection. */
export function githubFedModules(): string[] {
  const stored = GITHUB_LANDINGS.filter((l) => l.store !== null).map((l) => l.module as string);
  return [...new Set([...stored, ...GITHUB_READ_BY])];
}

export interface SyncArrival { kind: string; module: string; label: string; count: number; stored: boolean }

/** What one sync brought, per kind, from its log row's counts. A kind it did not report is left out, never 0. */
export function syncArrivals(counts: Record<string, unknown> | null | undefined): SyncArrival[] {
  if (!counts || typeof counts !== 'object') return [];
  return GITHUB_LANDINGS.flatMap((l) => {
    const n = counts[l.count];
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) return [];
    return [{ kind: l.kind, module: l.module, label: MODULE_LABELS[l.module] ?? l.module, count: n, stored: l.store !== null }];
  });
}

/** "12 issues → Product roadmap, 3 pull requests → Prototype / MVP, 2 releases counted". */
export function syncArrivalsText(arrivals: SyncArrival[]): string {
  if (!arrivals.length) return 'Not recorded';
  return arrivals.map((a) => {
    const l = GITHUB_LANDINGS.find((x) => x.kind === a.kind)!;
    const items = `${a.count} ${a.count === 1 ? l.one : l.many}`;
    return a.stored ? `${items} → ${a.label}` : `${items} counted`;
  }).join(', ');
}

// Anything shaped like a credential is hidden before a stored error is shown.
const SECRET_SHAPES = [
  /\bgh[opsur]_[A-Za-z0-9_]{8,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{8,}/g,
  /\bBearer\s+\S+/gi,
  /\b(?:token|secret|password|code)=[^\s&]+/gi,
  /\b[A-Za-z0-9+_-]{32,}={0,2}/g,
];

/**
 * A failed sync's words for a member: the stored message without its leading
 * code, and with anything credential-shaped replaced. A message with no words
 * reads as a plain failure.
 */
export function syncErrorWords(message: string | null | undefined): string {
  const raw = String(message ?? '').trim();
  const words = raw.replace(/^[a-z][a-z0-9_]*:\s*/, '').trim();
  let out = words || 'The sync did not complete.';
  for (const shape of SECRET_SHAPES) out = out.replace(shape, '[hidden]');
  return out.slice(0, 300);
}
