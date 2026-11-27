/**
 * D4615 (#4615) — the one effective notification rule. `notify()` applies it
 * before it writes an inbox row, pushes, or queues an email; `GET
 * /api/settings/notifications` reports the same defaults and mandatory
 * categories, so what Settings shows is what delivery does.
 *
 * PRECEDENCE, in order:
 *   1. Mandatory messages. Email for a locked event type (capital call issued,
 *      agreement ready to sign) is always sent. A mandatory category (security,
 *      billing, contract signing) ignores category-level opt-outs; its event
 *      switches still apply to in-app and Slack, as before.
 *   2. Otherwise a channel is delivered only when NEITHER the event switch NOR
 *      the category switch turns it off. Nothing stored means on, at both
 *      levels. So an event switch can narrow a category, and a category switch
 *      silences every event in it — including events a preset stored as on.
 *   3. Category switches exist for email and in-app. Slack follows the event
 *      switch only. Push follows in-app (it mirrors the inbox row).
 *   4. Quiet hours and the digest decide WHEN, never WHETHER: they apply after
 *      this rule, to what it let through.
 */

export type Channel = 'in_app' | 'email' | 'slack';

/** The categories a member can switch, in the order Settings lists them. */
export const USER_CATEGORIES = ['mentions', 'deals', 'calendar', 'scoring', 'billing', 'proactive_nudges'] as const;

/** Categories no member can opt out of at category level. Also the ones quiet hours and the digest never delay. */
export const MANDATORY_CATEGORIES: ReadonlySet<string> = new Set(['security', 'billing', 'contract_sign_request']);

/** Event types whose email is always sent (Settings draws the switch locked). */
export const LOCKED_EMAIL_TYPES: ReadonlySet<string> = new Set(['capital_call_issued', 'agreement_ready_to_sign']);

export type CategoryMaps = { email: Record<string, unknown>; inapp: Record<string, unknown> };
export type Decision = { channels: Channel[]; suppressed: Array<{ channel: Channel; by: 'event' | 'category' }> };

const off = (v: unknown) => v === false;

/** Which requested channels a notification goes out on. Pure. */
export function effectiveChannels(a: {
  type: string; category?: string | null; requested: Channel[];
  eventPrefs: Record<string, any> | null | undefined; categories: CategoryMaps | null | undefined;
}): Decision {
  const ev = (a.eventPrefs && typeof a.eventPrefs === 'object' ? (a.eventPrefs[a.type] || {}) : {}) as Record<string, unknown>;
  const mandatoryCategory = !!a.category && MANDATORY_CATEGORIES.has(a.category);
  const out: Channel[] = [];
  const suppressed: Decision['suppressed'] = [];
  for (const ch of a.requested) {
    if (ch === 'email' && LOCKED_EMAIL_TYPES.has(a.type)) { out.push(ch); continue; }
    if (off(ev[ch])) { suppressed.push({ channel: ch, by: 'event' }); continue; }
    if (a.category && !mandatoryCategory && ch !== 'slack') {
      const map = ch === 'email' ? a.categories?.email : a.categories?.inapp;
      if (map && off(map[a.category])) { suppressed.push({ channel: ch, by: 'category' }); continue; }
    }
    out.push(ch);
  }
  return { channels: out, suppressed };
}

/** The category switches as delivery reads them: every user category, with its effective value and whether it is locked. */
export function effectiveCategoryDefaults(categories: CategoryMaps) {
  const row = (map: Record<string, unknown>) => Object.fromEntries(USER_CATEGORIES.map((k) => [k, MANDATORY_CATEGORIES.has(k) ? true : !off(map[k])]));
  return {
    email: row(categories.email),
    inapp: row(categories.inapp),
    locked: USER_CATEGORIES.filter((k) => MANDATORY_CATEGORIES.has(k)),
  };
}

/**
 * A category save, merged into what is stored: only the keys sent change,
 * `null` clears a key (back to the default, on). A mandatory category cannot be
 * turned off. Returns the merged map, or the reason it is refused.
 */
export function mergeCategoryPatch(stored: Record<string, unknown>, patch: unknown):
  { ok: true; value: Record<string, boolean> } | { ok: false; field: string; message: string } {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, field: 'categories', message: 'must be an object of category to true or false' };
  const next: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(stored || {})) if (typeof v === 'boolean') next[k] = v;
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!(USER_CATEGORIES as readonly string[]).includes(k)) return { ok: false, field: k, message: `${k} is not a notification category` };
    if (v === null) { delete next[k]; continue; }
    if (typeof v !== 'boolean') return { ok: false, field: k, message: `${k} is true or false` };
    if (v === false && MANDATORY_CATEGORIES.has(k)) return { ok: false, field: k, message: `${k} messages are always sent and cannot be turned off` };
    next[k] = v;
  }
  return { ok: true, value: next };
}
