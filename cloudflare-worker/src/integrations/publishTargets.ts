/**
 * D1319 (#3480, part 1 of #2400) — what each provider's publish capability
 * is, as data: one row per publishing provider. Each provider issue (Beehiiv
 * #2407, X #2403, TikTok #2401, Facebook #2399) adds its own row with its
 * adapter; part 1 adds none, so nothing can be published yet.
 *
 * A ROW WITH AN UNKNOWN LIMIT REFUSES TO PREVIEW. `retract` is `delete` (the
 * provider deletes the post), `none` (a draft StudioOS never deletes) or
 * `unknown`. `modules` are `PUBLISH_MODULES` keys. `verified_on` is set by
 * the owner's first live publish.
 *
 * Publishing is never a `sends` row and has no `default_mode`, so neither
 * `autopush.ts` nor `send_modes` can reach it. No side effects and no
 * imports: the registry and the pages may read it.
 */

export type RetractKind = 'delete' | 'none' | 'unknown';

export interface PublishTarget {
  /** The registry key of the provider. */
  key: string;
  /** Characters a post's text may hold, or null when not confirmed: a null limit refuses to preview. */
  text_limit: number | null;
  /** Images (or files) a post may carry; 0 for none. Null when not confirmed. */
  media_limit: number | null;
  media_types: readonly string[];
  /** Who sees it, as the confirm line says it ("Public", "Draft only: not sent to subscribers"). */
  audience: string;
  retract: RetractKind;
  modules: readonly string[];
  verified_on: string | null;
}

export const PUBLISH_TARGETS: readonly PublishTarget[] = Object.freeze([]);

/** The owner's ceiling on sends a destination makes a day (#2400 decision D); a founder may set lower. */
export const PUBLISH_DAILY_CAP = 10;

const EXTRA = new Map<string, PublishTarget>();

/**
 * A row for a test's fake publisher only. A provider's real row lives in
 * `PUBLISH_TARGETS`, held to its `publishes` entry and page tools by a test;
 * `publish_core_d1319.test.ts` fails if any source file calls this.
 */
export function registerPublishTarget(row: PublishTarget): void {
  EXTRA.set(row.key, Object.freeze({ ...row }));
}

/** The provider's publish row, or null when it does not publish. */
export function publishTarget(key: string | null | undefined): PublishTarget | null {
  if (!key) return null;
  return PUBLISH_TARGETS.find((t) => t.key === key) ?? EXTRA.get(key) ?? null;
}
