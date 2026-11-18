/**
 * D6865 (#6865) — Grow v2 › Customers › Feedback (the #6099 canvas, GR-21 to
 * GR-31): the Feedback tab's three counts, one theme's weight, and Mark told
 * for several people at once.
 *
 * A theme's weight is who asked and what their companies paid, never a score:
 *   - people: distinct askers, keyed by their linked contacts record, else
 *     their email, else their typed name; an item naming nobody is counted
 *     apart, as "not named", never folded into a person;
 *   - revenue: recurring revenue on the venture's ledger (`revenue_entries`,
 *     `revenue_type = 'recurring'`) received in the last 60 days under each
 *     asker's company name, exactly as the record view's Plan row reads it
 *     (`services/records/grow.ts`). Each currency is summed apart. An asker
 *     with no company, or whose company has no such revenue, is listed under
 *     Not recorded with the reason: never as $0;
 *   - the roadmap items that answer the theme.
 * No impact, rank or value number is computed (D6099).
 *
 * Mark told for several (GR-26) applies only to rows that can be told:
 * shipped, asked to be told, not told yet. Every other row is named with its
 * reason, and no row is skipped silently. Axal never sends anything: each told
 * row comes back with a mailto draft when an email is recorded.
 */
import type { Env, User } from '../types';
import { Refused, TOLD_VIA, logGrowWrite, oneOf } from './growWriters';

type Row = Record<string, unknown>;

export const WEIGHT_WINDOW_DAYS = 60;
const MAX_TOLD = 100;

/** The tab's three counts, each over every item of the venture (no period: they count the store as it is now). */
export async function feedbackCounts(env: Env, pid: number) {
  const r = await env.DB.prepare(
    `SELECT SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_items,
            COUNT(DISTINCT CASE WHEN theme IS NOT NULL AND theme <> '' THEN theme END) AS themes,
            SUM(CASE WHEN status = 'shipped' AND notify_on_ship = 1 AND told_at IS NULL THEN 1 ELSE 0 END) AS shipped_not_told,
            COUNT(*) AS items
       FROM product_feedback WHERE project_id = ?`,
  ).bind(pid).first<Row>();
  return {
    items: Number(r?.items ?? 0),
    open_items: Number(r?.open_items ?? 0),
    themes: Number(r?.themes ?? 0),
    shipped_not_told: Number(r?.shipped_not_told ?? 0),
    period: 'all feedback recorded on this venture',
  };
}

/** Who an item's asker is, for counting distinct people: the linked record, then the email, then the typed name. */
export function personKey(f: { contact_uid?: unknown; from_email?: unknown; from_name?: unknown }): string | null {
  const c = typeof f.contact_uid === 'string' && f.contact_uid ? f.contact_uid : null;
  if (c) return `contact:${c}`;
  const e = typeof f.from_email === 'string' && f.from_email.trim() ? f.from_email.trim().toLowerCase() : null;
  if (e) return `email:${e}`;
  const n = typeof f.from_name === 'string' && f.from_name.trim() ? f.from_name.trim().toLowerCase() : null;
  return n ? `name:${n}` : null;
}

/** One theme's weight (GR-23). A writer's read: it names people. */
export async function themeWeight(env: Env, pid: number, rawTheme: unknown, now = Date.now()) {
  const theme = typeof rawTheme === 'string' ? rawTheme.trim().slice(0, 80) : '';
  if (!theme) throw new Refused(400, 'Name the theme to weigh', 'theme');
  const items = ((await env.DB.prepare(
    `SELECT f.uid, f.status, f.from_name, f.from_email, f.from_company, f.contact_uid, f.notify_on_ship, f.told_at, f.told_via, f.shipped_on,
            c.name AS contact_name, c.audience AS contact_audience, c.status AS contact_status
       FROM product_feedback f LEFT JOIN contacts c ON c.uid = f.contact_uid AND c.project_id = f.project_id
      WHERE f.project_id = ? AND f.theme = ? ORDER BY f.created_at, f.id`,
  ).bind(pid, theme).all<Row>()).results || []);
  if (!items.length) throw new Refused(404, 'No feedback has that theme', 'theme');

  const byStatus = { open: 0, planned: 0, shipped: 0 } as Record<string, number>;
  const people = new Map<string, Row>();
  let unnamed = 0;
  for (const f of items) {
    byStatus[String(f.status)] = (byStatus[String(f.status)] ?? 0) + 1;
    // A contact_uid whose record is gone (no join row) reads as not linked.
    const linked = !!f.contact_uid && f.contact_audience != null;
    const key = personKey({ contact_uid: linked ? f.contact_uid : null, from_email: f.from_email, from_name: f.from_name });
    if (!key) { unnamed += 1; continue; }
    const seen = people.get(key);
    if (seen) { seen.items = Number(seen.items) + 1; if (!seen.company && f.from_company) seen.company = f.from_company; continue; }
    people.set(key, {
      name: (linked ? f.contact_name : null) ?? f.from_name ?? null,
      email: f.from_email ?? null,
      company: f.from_company ?? null,
      record: linked ? { uid: f.contact_uid, audience: f.contact_audience, status: f.contact_status } : null,
      items: 1,
    });
  }

  const since = new Date(now - WEIGHT_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const companies = [...new Set([...people.values()].map((p) => p.company).filter((c): c is string => typeof c === 'string' && !!c))];
  const paid = new Map<string, { currency: string; cents: number }[]>();
  if (companies.length) {
    const q = await env.DB.prepare(
      `SELECT customer, currency, SUM(amount_cents) AS cents FROM revenue_entries
        WHERE project_id = ? AND revenue_type = 'recurring' AND received_on >= ? AND customer IN (${companies.map(() => '?').join(', ')})
        GROUP BY customer, currency`,
    ).bind(pid, since, ...companies).all<Row>();
    for (const r of q.results || []) {
      const list = paid.get(String(r.customer)) ?? [];
      list.push({ currency: String(r.currency || 'usd').toUpperCase(), cents: Number(r.cents) });
      paid.set(String(r.customer), list);
    }
  }
  const totals = new Map<string, number>();
  const notRecorded: { name: string | null; reason: string }[] = [];
  const asked = [...people.values()].map((p) => {
    const company = p.company as string | null;
    const money = company ? paid.get(company) ?? null : null;
    if (!company) notRecorded.push({ name: (p.name as string | null) ?? (p.email as string | null), reason: 'No company named on their feedback' });
    else if (!money) notRecorded.push({ name: (p.name as string | null) ?? company, reason: `No recurring revenue on the ledger names ${company} in the last ${WEIGHT_WINDOW_DAYS} days` });
    return { ...p, revenue: money };
  });
  for (const list of paid.values()) for (const m of list) totals.set(m.currency, (totals.get(m.currency) ?? 0) + m.cents);

  const roadmap = ((await env.DB.prepare(
    'SELECT id, objective FROM roadmap_okrs WHERE project_id = ? AND feedback_theme = ? ORDER BY id',
  ).bind(pid, theme).all<Row>()).results || []).map((o) => ({ id: Number(o.id), label: String(o.objective) }));

  // GR-26: everyone who gave feedback on the theme, with whether they can be told now and, if not, why.
  const loop = items.map((f) => ({
    uid: f.uid, name: f.from_name ?? null, has_email: !!f.from_email, status: f.status,
    shipped_on: f.shipped_on ?? null, told_at: f.told_at ?? null, told_via: f.told_via ?? null,
    state: f.told_at ? 'told' : why(f) ? 'cannot' : 'due', reason: f.told_at ? null : why(f),
  }));

  return {
    theme,
    items: items.length,
    loop,
    by_status: byStatus,
    people: asked,
    distinct_people: people.size,
    not_named: unnamed,
    revenue: {
      window_days: WEIGHT_WINDOW_DAYS,
      since,
      source: 'Recurring revenue on the venture ledger under the asker’s company name',
      by_currency: [...totals.entries()].map(([currency, cents]) => ({ currency, cents })).sort((a, b) => a.currency.localeCompare(b.currency)),
      companies_with_revenue: paid.size,
      companies_named: companies.length,
      not_recorded: notRecorded,
    },
    roadmap_items: roadmap,
  };
}

const why = (f: Row): string | null => {
  if (Number(f.notify_on_ship) !== 1) return 'Did not ask to be told';
  if (f.status !== 'shipped') return 'Not shipped yet';
  if (f.told_at) return 'Already told';
  return null;
};

/** Mark told for several items at once (GR-26). Each refused row is named with its reason. */
export async function markFeedbackToldMany(env: Env, pid: number, user: User, b: Row) {
  const uids = Array.isArray(b.uids) ? [...new Set(b.uids.filter((u): u is string => typeof u === 'string' && !!u.trim()).map((u) => u.trim()))] : [];
  if (!uids.length) throw new Refused(400, 'Choose who you told', 'uids');
  if (uids.length > MAX_TOLD) throw new Refused(400, `Mark at most ${MAX_TOLD} people told at once`, 'uids');
  const via = oneOf(b.via, TOLD_VIA, 'via', true)!;
  const rows = ((await env.DB.prepare(
    `SELECT id, uid, body, from_name, from_email, roadmap_item_label, notify_on_ship, status, told_at FROM product_feedback
      WHERE project_id = ? AND uid IN (${uids.map(() => '?').join(', ')})`,
  ).bind(pid, ...uids).all<Row>()).results || []);
  const found = new Map(rows.map((r) => [String(r.uid), r]));
  const at = new Date().toISOString();
  const told: Row[] = []; const refused: Row[] = [];
  for (const uid of uids) {
    const f = found.get(uid);
    // Another venture's item and a missing one read alike.
    if (!f) { refused.push({ uid, name: null, reason: 'Not found' }); continue; }
    const reason = why(f);
    if (reason) { refused.push({ uid, name: f.from_name ?? null, reason }); continue; }
    const what = f.roadmap_item_label ? `"${f.roadmap_item_label}"` : 'what you asked for';
    told.push({
      uid, id: f.id, name: f.from_name ?? null,
      mailto: f.from_email ? `mailto:${encodeURIComponent(String(f.from_email))}?subject=${encodeURIComponent('It shipped')}&body=${encodeURIComponent(
        `Hi${f.from_name ? ` ${f.from_name}` : ''},\n\nYou told us: "${String(f.body).slice(0, 300)}"\n\n${what} has shipped. Thank you for asking for it.\n`)}` : null,
      no_email: !f.from_email,
    });
  }
  if (told.length) {
    // Guarded again in SQL, so a row told by another tab between the read and the write is not told twice.
    await env.DB.batch(told.map((t) => env.DB.prepare(
      `UPDATE product_feedback SET told_at = ?, told_via = ?, updated_by = ?, updated_at = ?
        WHERE id = ? AND project_id = ? AND status = 'shipped' AND notify_on_ship = 1 AND told_at IS NULL`,
    ).bind(at, via, user.id, at, t.id, pid)));
    await logGrowWrite(env, pid, user.id, { module: 'product-improvement', entityId: null, action: 'grow_feedback_told_many',
      summary: `${told.length} ${told.length === 1 ? 'customer' : 'customers'} told it shipped (${via.replace('_', ' ')})` });
  }
  return {
    told_at: told.length ? at : null, told_via: via,
    told: told.map(({ id: _id, ...t }) => t),
    refused,
  };
}
