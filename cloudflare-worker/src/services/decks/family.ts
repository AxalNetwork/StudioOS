/**
 * The family rule's one function (D1525, D1551): a model id's family. Pure, and
 * importing nothing, so the judge can use it on the generation cron path
 * without reaching the deck's sources (`mercury_member_privacy_d752`).
 * `critic.ts` re-exports it, so its callers are unchanged.
 */

/** A model id's family: `@cf/<org>/…` → org, `anthropic/…` or `claude…` → anthropic; null when unreadable. */
export function familyOf(model: string | null | undefined): string | null {
  const id = String(model ?? '').trim().toLowerCase();
  if (!id) return null;
  const cf = /^@cf\/([^/]+)\//.exec(id);
  if (cf) return cf[1];
  if (/^(anthropic\/|claude)/.test(id)) return 'anthropic';
  const org = /^([a-z0-9._-]+)\//.exec(id);
  return org ? org[1] : null;
}
