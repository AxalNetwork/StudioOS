/**
 * D1083 (#2948) — the words and states of From Lovable (LV5, LV6, LV7's part),
 * from `parts.lovable`: `{ state: 'ok', slots: [{ record_id, label, link }] }`
 * or `{ state: 'unreadable' }`.
 */

export const LOVABLE_WORDS = {
  title: 'From Lovable',
  connector: 'Connector · Lovable',
  empty: 'No app linked yet. Paste the address Lovable gave you.',
  placeholder: 'https://….lovable.app',
  link: 'Link the app',
  loading: 'Reading…',
  inviteOnly: 'The app may be Invite only in Lovable.',
  unreadable: 'Lovable’s figures could not be read. The address and its last check are kept.',
  retry: 'Try again',
  check: 'Check now',
  notChecked: 'Not checked yet. Check now reads the address once.',
  hostedOnVercel: 'Hosted on Vercel',
  remove: 'Remove…',
};

/** "2026-10-23 14:05" (UTC), the canvas's form; null when there is no time. */
export function checkedAt(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)}`;
}

/** What one slot draws. */
export function slotView(slot) {
  const link = slot && typeof slot === 'object' ? slot.link : null;
  if (!link || typeof link !== 'object') return { kind: 'empty' };
  const when = checkedAt(link.checked_at);
  const base = { kind: 'linked', address: String(link.app_url ?? ''), uid: link.uid, title: link.title || null };
  if (link.hosted_on === 'vercel') return { ...base, status: 'vercel', pill: LOVABLE_WORDS.hostedOnVercel, tone: 'grey', line: null };
  if (link.status === 'live' && when) return { ...base, status: 'live', pill: 'Live', tone: 'ok', line: `checked ${when}` };
  if (link.status === 'not_reachable' && when) {
    return { ...base, status: 'not_reachable', pill: 'Not reachable', tone: 'warn', line: `Not reachable, checked ${when}.`, note: LOVABLE_WORDS.inviteOnly };
  }
  return { ...base, status: 'not_checked', pill: 'Not checked', tone: 'grey', line: LOVABLE_WORDS.notChecked };
}
