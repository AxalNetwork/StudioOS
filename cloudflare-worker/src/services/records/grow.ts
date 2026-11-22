/**
 * D691 (S19-A, #1698) — Grow's seven records on D690's contract, as CO:382-388
 * draws them: Product improvement (a feedback uid), Distribution (a channel
 * uid), Revenue and traction (a KPI key), Team expansion (a posting id),
 * Partner network (a partner uid), Market expansion (a market uid) and Durable
 * company-building (an obligation id).
 *
 * WHO (D-u, decision 9). Every gate is `canAccessProject`, unchanged: the
 * owner, a co-founder member, a partner and an admin read and write; an
 * advisor member reads only, and an investor or another venture's founder
 * gets 403. Third parties' names (a customer, a partner's contact, the
 * customers a channel acquired, a deal's customer) are for writers; everyone
 * else sees counts. Applicant names follow the jobs board's `canManage`: the
 * posting's host or an admin. Close role and Edit's `publish` are declared
 * for the same two only (decision 6). A foreign id is a 404 in `ownedRow`
 * before any of this runs.
 *
 * WHAT IS DRAWN. Each record reads its own store; where none holds a value it
 * says "Not recorded" with the reason, never 0 (decision 10). Every action
 * runs the writer its route runs (`services/growWriters.ts`,
 * `services/growKpis.ts`), so a record and a route write a row one way.
 * Activity is `grow.<slug>`; each spec's `oldRows` admits the rows today's
 * writes logged before the convention, read as written and never rewritten.
 */
import type { Env, User } from '../../types';
import type { ProjectRef } from '../../routes/_founder_validate_helpers';
import { canAccessProject } from '../projectAccess';
import { ensureProjectMetricsSchema } from '../../routes/progress';
import { APPLICATION_STAGES, channelRows, readiness, utmSource, MARKET_PARTS, type Ctx as GrowCtx, type MarketRow } from '../growCycle';
import { billingPeriods, computeMovements, movementGap, readRecurring } from '../revenueMovements';
import {
  CUSTOM_PREFIX, CUSTOM_UNITS, KPI_KEYS, KPI_LABEL, KpiRefused, alertText, customKpis, enterKpi, kpiEntries, kpiMonths, kpiRows, removeKpiEntry, type KpiAlert, type KpiRow,
} from '../growKpis';
import {
  ALERT_MEASURES, ALERT_OPS, CHANNEL_KINDS, CHANNEL_STATES, DECISIONS, FEEDBACK_SOURCES, FEEDBACK_STATUS, LOCALISATION_KEYS,
  MARKET_STATES, OBLIGATION_KINDS, OBLIGATION_STATES, PARTNER_STAGES, PARTNER_TYPES, REPEATS, REPEATS_OF, ROLE_TYPES, Refused,
  TERMS_KINDS, TOLD_VIA, addAgendaItem, decideMarketProposal, addEntryStep, addExperiment, addPartnerDeal, closeRole, logGrowWrite, markFeedbackTold,
  markHeld, obligationKind, obligationState, openMinutes, removeAgendaItem, removeEntryStep, removeMarket, removeObligation, removePartner, removePartnerDeal, setApplicationStage, setFeedbackTheme, setKpiAlert, setLocalisation, updateChannel,
  updateAgendaItem, updateEntryStep, updateFeedback, updateMarket, updateObligation, updatePartner, updatePartnerDeal, updateRole,
} from '../growWriters';
import { dayList, reminderAssignee, reminderLabel } from '../growDaily';
import { companyTeam, onCompanyTeam, ownerShown } from '../obligationOwner';
import { partnerRevenueSource, setPartnerRevenue } from '../growWriters';
import { parseMinor, plainAmount, suffixAmount } from '../../../../frontend/src/lib/money.js';
import type {
  ActionResult, Gate, ModuleSpec, OldRowsMatcher, RecordAction, RecordContent, RecordContext, RecordFact, RecordField, Row,
  SectionSpec, Store,
} from './types';

type Any = Record<string, any>;
type Body = Record<string, unknown> | FormData;

// ── Shared ──────────────────────────────────────────────────────────────────

/** D-u: Grow reads and writes through `canAccessProject`, unchanged. */
const readGate: Gate = (project: ProjectRef, user: User, env: Env) => canAccessProject(env, user, project, { write: false });
const writeGate: Gate = (project: ProjectRef, user: User, env: Env) => canAccessProject(env, user, project, { write: true });
const isWriter = (rc: RecordContext) => canAccessProject(rc.env, rc.user, rc.project, { write: true });
/** The jobs board's `canManage` (`jobs.ts`): the posting's host or an admin. */
const managesPosting = (rc: RecordContext, hostId: unknown) => rc.user.role === 'admin' || Number(hostId) === Number(rc.user.id);
const userOf = (rc: RecordContext) => rc.user as User;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "12 Oct", as the canvas writes a date; null when there is none. */
function dMon(raw: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? ''));
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month}` : null;
}
const joined = (...parts: Array<string | null | undefined>) => parts.filter((p) => p != null && p !== '').join(' · ');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const fact = (label: string, value: string | number | null | undefined, reason: string): RecordFact =>
  (value == null || value === '' ? { label, value: null, reason } : { label, value });
const notRecorded = (a: string, reason: string): Row => ({ a, b: reason, c: 'Not recorded', tone: 'grey' });
const opts = (values: readonly string[], label: Record<string, string>) => values.map((v) => ({ value: v, label: label[v] ?? v }));
const field = (body: Body, key: string): unknown => (body instanceof FormData ? body.get(key) ?? undefined : body[key]);
const plain = (body: Body): Record<string, unknown> => (body instanceof FormData ? Object.fromEntries(body.entries()) : body);
/** Only the keys an Edit declares reach its writer, so a stray key cannot widen a PATCH. */
const pick = (body: Body, keys: readonly string[]): Record<string, unknown> => {
  const b = plain(body); const out: Record<string, unknown> = {};
  for (const k of keys) if (b[k] !== undefined) out[k] = b[k];
  return out;
};
const checked = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 && v.some((x) => x === '1' || x === true) : v === true || v === 1 || v === '1' || v === 'true');

const SYMBOL: Record<string, string> = { usd: '$', eur: '€', gbp: '£' };
function money(cents: unknown, currency: unknown = 'usd'): string | null {
  if (cents == null || cents === '' || !Number.isFinite(Number(cents))) return null;
  const c = String(currency || 'usd').toLowerCase();
  // D5373: at the currency's own decimals; an unlisted code names the stored count.
  const plain = plainAmount(Number(cents), c.toUpperCase(), { trimWhole: true });
  return plain === null ? String(suffixAmount(Number(cents), c.toUpperCase())) : `${SYMBOL[c] ?? `${c.toUpperCase()} `}${plain}`;
}

/** A writer's refusal, as the status and sentence the route answers with (as Validate's records do). */
async function refusing(work: () => Promise<ActionResult>): Promise<ActionResult> {
  try { return await work(); } catch (err) {
    if (err instanceof Refused || err instanceof KpiRefused) {
      throw new Response(JSON.stringify({ detail: err.sentence, ...(err.field ? { field: err.field } : {}),
        ...(err instanceof KpiRefused && err.code ? { code: err.code } : {}) }),
        { status: err.status, headers: { 'Content-Type': 'application/json' } });
    }
    throw err;
  }
}
/** `ownedRow` passed before the spec ran, so a missing row is a race with a delete. */
const vanished = () => new Response(JSON.stringify({ detail: 'Record not found.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });

/**
 * D6115 (#6115): Remove, a danger write behind a confirmation, for a record
 * added by mistake. The writer deletes it or refuses (409) with what to do
 * instead; the page's re-read then 404s and goes back to the list.
 */
const remove = (title: string, body: string, run: (c: RecordContext) => Promise<unknown>): RecordAction => ({
  key: 'remove', label: 'Remove', kind: 'write', tone: 'danger', confirm: { title, body, cta: 'Remove' },
  execute: (c) => refusing(async () => ({ ok: true, record: await run(c) })),
});

/** What a record read loaded, for its sections and actions; never sent (the route spreads the record). */
const loaded = new WeakMap<RecordContent, Any>();
const loadedOf = (record: RecordContent): Any => loaded.get(record) ?? {};
const keep = (out: RecordContent, data: Any): RecordContent => { loaded.set(out, data); return out; };

const section = (key: string, title: string, read: SectionSpec['read'], extra: Partial<SectionSpec> = {}): SectionSpec => ({ key, title, read, ...extra });
/** A section holding a third party's name: for writers only (decision 9). */
const writersOnly: Partial<SectionSpec> = { gate: writeGate, publicGate: 'write' };

function spec(store: Store, slug: string, oldRows: OldRowsMatcher | undefined, record: ModuleSpec['record'], sections: SectionSpec[],
  actions: ModuleSpec['actions'], formOptions: ModuleSpec['formOptions']): ModuleSpec {
  return { read: readGate, write: writeGate, store, activityType: `grow.${slug}`, oldRows, record, sections, actions, formOptions };
}

const growCtx = (rc: RecordContext): GrowCtx => ({ env: rc.env, projectId: rc.projectId, now: Date.now(), href: (slug) => `/grow/${slug}?project_id=${rc.projectId}` });

const LABEL: Record<string, string> = {
  customer: 'Customer', investor: 'Investor', team: 'Team', open: 'Open', planned: 'Planned', shipped: 'Shipped',
  active: 'Active', testing: 'Testing', paused: 'Paused',
  organic: 'Organic', ads: 'Ads', newsletter: 'Newsletter', outreach: 'Outreach', signups: 'Sign-ups',
  content: 'Content', paid_search: 'Paid search', paid_social: 'Paid social', outbound: 'Outbound', partner: 'Partner', events: 'Events',
  draft: 'Draft', pending_review: 'Pending review', published: 'Live', rejected: 'Rejected', closed: 'Closed',
  full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract', fractional: 'Fractional',
  applied: 'Applied', screen: 'Screen', interview: 'Interview', offer: 'Offer', hired: 'Hired', declined: 'Declined',
  reseller: 'Reseller', integration: 'Integration', agency: 'Agency', referral: 'Referral', co_marketing: 'Co-marketing', other: 'Other',
  talking: 'Talking', terms: 'Terms', signed: 'Signed', ended: 'Ended',
  rev_share: 'Rev-share', services_fee: 'Services fee', referral_fee: 'Referral fee', none: 'None yet',
  considering: 'Considering', entering: 'Entering', served: 'Served', not_now: 'Not now',
  enter: 'Enter', not_yet: 'Not yet', exit: 'Exit',
  governance: 'Governance', compliance: 'Compliance', risk: 'Risk', culture: 'Culture', tax: 'Tax',
  scheduled: 'Scheduled', upcoming: 'Upcoming', done: 'Done', overdue: 'Overdue', snoozed: 'Snoozed', not_set_up: 'Not set up',
  once: 'Once', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly',
  email: 'Email', call: 'Call', message: 'Message', in_person: 'In person',
  language: 'Language', payments: 'Payments', legal_entity: 'Legal entity',
  value: 'Value', change_30d_pct: 'Change over 30 days (%)', below: 'Below', above: 'Above',
};
const label = (v: unknown) => LABEL[String(v)] ?? String(v ?? '');
const TONE: Record<string, string> = {
  open: 'grey', planned: 'vio', shipped: 'ok', active: 'ok', testing: 'vio', paused: 'grey',
  draft: 'grey', pending_review: 'amb', published: 'ok', rejected: 'bad', closed: 'grey',
  talking: 'grey', terms: 'vio', signed: 'ok', ended: 'grey',
  considering: 'grey', entering: 'vio', served: 'ok', not_now: 'grey',
  scheduled: 'vio', upcoming: 'grey', done: 'ok', overdue: 'bad', snoozed: 'grey',
};
const pill = (v: unknown) => ({ text: label(v), tone: TONE[String(v)] ?? 'grey' });

// ── Older activity (step 4) ─────────────────────────────────────────────────
// Today's `logWrite` wrote a table name, the record id, a `grow_*` action and
// no `project_id`; a month's figure as `<uid>:<month>`, an application's stage
// under the application. Read as written, never rewritten.

export const GROW_OLD_ROWS: Record<string, OldRowsMatcher> = {
  'product-improvement': { entityTypes: ['product_feedback'], unscopedActions: ['grow_feedback_logged', 'grow_feedback_updated'] },
  distribution: { entityTypes: ['growth_channels'], idPrefixTypes: ['channel_spend'],
    unscopedActions: ['grow_channel_added', 'grow_channel_updated', 'grow_channel_spend'] },
  'team-expansion': { entityTypes: ['job_postings'], children: ['job_applications'], unscopedActions: ['grow_role_updated', 'grow_application_stage'] },
  'partner-network': { entityTypes: ['growth_partners'], idPrefixTypes: ['partner_revenue'],
    unscopedActions: ['grow_partner_added', 'grow_partner_updated', 'grow_partner_revenue'] },
  'market-expansion': { entityTypes: ['markets'], unscopedActions: ['grow_market_added', 'grow_market_updated'] },
  'durable-company-building': { entityTypes: ['compliance_events'], unscopedActions: ['grow_obligation_added', 'grow_obligation_updated'] },
};

// ── Product improvement — id: the feedback's uid ────────────────────────────

/** A theme's status, from its items: Shipped when every one has, else Planned when any is past Open. */
function themeStatus(byStatus: Map<string, number>): string {
  const total = [...byStatus.values()].reduce((a, b) => a + b, 0);
  if (total && (byStatus.get('shipped') ?? 0) === total) return 'shipped';
  return (byStatus.get('planned') ?? 0) + (byStatus.get('shipped') ?? 0) > 0 ? 'planned' : 'open';
}

async function feedbackThemes(env: Env, projectId: number): Promise<Array<{ value: string; label: string; count: number }>> {
  const res = await env.DB.prepare(
    `SELECT theme, COUNT(*) AS n FROM product_feedback WHERE project_id = ? AND theme IS NOT NULL AND trim(theme) <> ''
      GROUP BY theme ORDER BY n DESC, theme`,
  ).bind(projectId).all<{ theme: string; n: number }>();
  return (res.results || []).map((t) => ({ value: t.theme, label: t.theme, count: Number(t.n) }));
}

async function roadmapItems(env: Env, projectId: number): Promise<Array<{ value: string; label: string }>> {
  const res = await env.DB.prepare('SELECT id, objective FROM roadmap_okrs WHERE project_id = ? ORDER BY id DESC LIMIT 200')
    .bind(projectId).all<{ id: number; objective: string }>();
  return (res.results || []).map((r) => ({ value: String(r.id), label: String(r.objective).slice(0, 200) }));
}

/**
 * D6097 (#6097): Build's Add item with Answers feedback theme chosen (`forms.js` `buildItem.fromQuery`).
 * Saving it links the theme's open rows that have no roadmap item yet (`buildCreates.ts` `feedbackLink`).
 */
export const addToRoadmapHref = (projectId: number, theme: string) =>
  `/build/product-roadmap/new?project_id=${projectId}&feedback_theme=${encodeURIComponent(theme)}`;

const FEEDBACK_EDIT = ['body', 'source', 'from_name', 'from_email', 'from_company', 'theme', 'roadmap_item_ref', 'status', 'notify_on_ship', 'contact_uid'] as const;

const capital = (v: unknown) => { const t = String(v ?? '').replace(/_/g, ' '); return t ? t[0].toUpperCase() + t.slice(1) : t; };

/** D6865: the feedback origins (migration 202611161128) as the canvas words them. */
const ORIGIN_LABEL: Record<string, string> = {
  inbox_reply: 'Inbox reply', interview: 'Interview', notion: 'Notion', posthog_survey: 'PostHog survey', typed: 'Typed',
};

const productImprovement = spec('product_feedback', 'product-improvement', GROW_OLD_ROWS['product-improvement'], async (rc, id) => {
  const f = await rc.env.DB.prepare('SELECT * FROM product_feedback WHERE uid = ? AND project_id = ?').bind(id, rc.projectId).first<Any>();
  if (!f) throw vanished();
  const writer = await isWriter(rc);
  const byStatus = new Map<string, number>();
  if (f.theme) {
    const res = await rc.env.DB.prepare('SELECT status, COUNT(*) AS n FROM product_feedback WHERE project_id = ? AND theme = ? GROUP BY status')
      .bind(rc.projectId, f.theme).all<{ status: string; n: number }>();
    for (const r of res.results || []) byStatus.set(r.status, Number(r.n));
  }
  const body = String(f.body);
  return keep({
    title: `"${body.length > 140 ? `${body.slice(0, 139)}…` : body}"`,
    // A customer's name is for writers (decision 9).
    sub: joined(label(f.source), writer ? f.from_name : null, dMon(f.created_at)),
    pills: [pill(f.status), f.theme ? { text: String(f.theme), tone: 'vio' } : { text: 'No theme', tone: 'grey' }],
    facts: [
      fact('Source', label(f.source), ''),
      fact('Theme', f.theme, 'No theme yet'),
      fact('Roadmap item', f.roadmap_item_label, 'Not linked to a roadmap item'),
      fact('Status', label(f.status), ''),
      // D6865 (#6865): where it came from; a row older than the column reads Not recorded.
      fact('Origin', f.origin ? ORIGIN_LABEL[String(f.origin)] ?? String(f.origin) : null, 'Not recorded'),
    ],
    createdBy: f.created_by, createdAt: f.created_at,
  }, { f, byStatus });
}, [
  section('theme', 'Theme', async (_rc, _id, record) => {
    const { f, byStatus } = loadedOf(record);
    // D6097: Add to roadmap answers a theme, so a row with none has no Add to roadmap; the sentence says why.
    if (!f?.theme) return { rows: [], empty: 'No theme yet. Add to roadmap needs a theme.', action: 'change-theme' };
    const n = [...(byStatus as Map<string, number>).values()].reduce((a, b) => a + b, 0);
    const status = themeStatus(byStatus);
    // No impact store, so the row never says "High impact" (decision 10). The route strips the row's action for a reader.
    return { rows: [{ a: String(f.theme), b: plural(n, 'item', 'items'), c: label(status), tone: TONE[status], action: 'add-to-roadmap' }], action: 'change-theme' };
  }),
  section('closing-the-loop', 'Closing the loop', async (_rc, _id, record) => {
    const { f } = loadedOf(record);
    const due = f.status === 'shipped' && !f.told_at;
    return { rows: [{
      a: `Tell ${f.from_name || 'them'} it shipped`, b: f.told_via ? label(f.told_via).toLowerCase() : '',
      // Mark told records the founder's own telling; the platform sends nothing (decision 5).
      c: f.told_at ? `Told · ${dMon(f.told_at)}` : due ? 'Due' : 'When it ships', tone: f.told_at ? 'ok' : due ? 'amb' : 'grey',
      ...(due ? { action: 'mark-told' } : {}),
    }] };
  }, { ...writersOnly, when: (_id, record) => Number(loadedOf(record).f?.notify_on_ship) === 1 }),
  section('customer', 'Customer', async (rc, _id, record) => {
    const { f } = loadedOf(record);
    const rows: Row[] = [];
    const who = joined(f.from_name, f.from_company);
    rows.push(who ? { a: who, b: 'Customers →', href: `/grow/customers?project_id=${rc.projectId}` } : notRecorded('Customer', 'No customer named on this feedback'));
    // D6865 (#6865): the linked customer or prospect record (GR-22); a typed name with none reads Not linked.
    const rec = f.contact_uid
      ? await rc.env.DB.prepare('SELECT name, audience, status FROM contacts WHERE uid = ? AND project_id = ?').bind(f.contact_uid, rc.projectId)
        .first<{ name: string | null; audience: string; status: string }>()
      : null;
    rows.push(rec
      ? { a: 'Record', b: joined(rec.name, `${capital(rec.audience)} · ${capital(rec.status)}`) ?? 'Linked', tone: 'ok' }
      : { a: 'Record', b: 'Not linked', c: 'Link to a customer or prospect with Edit', tone: 'grey' });
    if (!f.from_company) rows.push(notRecorded('Plan', 'No company named on this feedback'));
    else {
      const since = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
      const paid = await rc.env.DB.prepare(
        "SELECT 1 FROM revenue_entries WHERE project_id = ? AND revenue_type = 'recurring' AND customer = ? AND received_on >= ? LIMIT 1",
      ).bind(rc.projectId, f.from_company, since).first();
      rows.push(paid ? { a: 'Plan', b: 'Paid', tone: 'ok' } : notRecorded('Plan', 'No paid revenue on the ledger names this company'));
    }
    return { rows };
  }, { side: true, ...writersOnly }),
], async (rc, id, record): Promise<RecordAction[]> => {
  const { f } = loadedOf(record);
  const uid = id;
  const themes = await feedbackThemes(rc.env, rc.projectId);
  const items = await roadmapItems(rc.env, rc.projectId);
  // D6865 (#6865): Link to a customer or prospect, from the venture's own contacts (newest first, at most 200).
  const people = ((await rc.env.DB.prepare(
    'SELECT uid, name, email, audience FROM contacts WHERE project_id = ? ORDER BY COALESCE(last_activity_at, created_at) DESC, id DESC LIMIT 200',
  ).bind(rc.projectId).all<{ uid: string; name: string | null; email: string; audience: string }>()).results || [])
    .map((p) => ({ value: String(p.uid), label: [p.name || p.email, p.name ? p.email : null, capital(p.audience)].filter(Boolean).join(' · ') }));
  const actions: RecordAction[] = [{
    key: 'change-theme', label: 'Change theme', kind: 'form',
    form: { title: 'Change theme', cta: 'Save', foot: 'A theme groups feedback that asks for the same thing.', fields: [
      { key: 'theme', label: 'Theme', kind: 'CH', value: f.theme ?? '', options: [{ value: '', label: 'No theme' }, ...themes.map(({ value, label: l }) => ({ value, label: l }))] },
      { key: 'new_theme', label: 'Or a new theme', kind: 'T', placeholder: '[Theme]' },
    ] },
    execute: (c, _id, body) => refusing(async () => {
      const next = String(field(body, 'new_theme') ?? '').trim() || String(field(body, 'theme') ?? '').trim() || null;
      return { ok: true, record: await setFeedbackTheme(c.env, c.projectId, uid, next, Number(c.user.id)) };
    }),
  }];
  // D6097: the theme's Add item in Build. Actions reach writers only (`cycle_records.ts`), so a reader never sees it.
  if (f.theme) actions.push({ key: 'add-to-roadmap', label: 'Add to roadmap', kind: 'link', href: addToRoadmapHref(rc.projectId, String(f.theme)) });
  if (Number(f.notify_on_ship) === 1 && f.status === 'shipped' && !f.told_at) {
    actions.push({
      key: 'mark-told', label: 'Mark told', kind: 'form',
      form: { title: 'Mark told', cta: 'Mark told', foot: f.from_email ? 'Opens a draft in your own mail. Axal never emails your customer.' : 'Axal never emails your customer.',
        fields: [{ key: 'via', label: 'How you told them', kind: 'CH', value: 'email', options: opts(TOLD_VIA, LABEL), required: true }] },
      execute: (c, _id, body) => refusing(async () => {
        const out = await markFeedbackTold(c.env, c.projectId, userOf(c), uid, { via: field(body, 'via') });
        return { ok: true, record: { uid: out.uid, told_at: out.told_at, told_via: out.told_via }, ...(out.mailto ? { open: { url: out.mailto } } : {}) };
      }),
    });
  }
  actions.push({
    key: 'edit', label: 'Edit', kind: 'form', tone: 'primary',
    form: { title: 'Edit feedback', cta: 'Save', fields: [
      { key: 'body', label: 'Feedback', kind: 'T', value: f.body, required: true },
      { key: 'source', label: 'Source', kind: 'CH', value: f.source, options: opts(FEEDBACK_SOURCES, LABEL) },
      { key: 'from_name', label: 'From', kind: 'T', value: f.from_name ?? '', placeholder: '[Name]' },
      { key: 'from_email', label: 'Email', kind: 'T', input: 'email', value: f.from_email ?? '' },
      { key: 'from_company', label: 'Company', kind: 'T', value: f.from_company ?? '' },
      { key: 'contact_uid', label: 'Customer or prospect record', kind: 'CH', value: f.contact_uid ?? '',
        options: [{ value: '', label: 'Not linked' }, ...people] },
      { key: 'theme', label: 'Theme', kind: 'T', value: f.theme ?? '' },
      { key: 'roadmap_item_ref', label: 'Roadmap item', kind: 'CH', value: f.roadmap_item_ref ?? '', options: [{ value: '', label: 'None yet' }, ...items] },
      { key: 'status', label: 'Status', kind: 'CH', value: f.status, options: opts(FEEDBACK_STATUS, LABEL) },
      { key: 'notify_on_ship', label: 'Tell them when it ships', kind: 'CK', value: Number(f.notify_on_ship) === 1 ? ['1'] : [],
        options: [{ value: '1', label: 'Tell them when it ships' }] },
    ] },
    execute: (c, _id, body) => refusing(async () => {
      const b = pick(body, FEEDBACK_EDIT);
      if (b.notify_on_ship !== undefined) b.notify_on_ship = checked(b.notify_on_ship);
      return { ok: true, record: await updateFeedback(c.env, c.projectId, userOf(c), uid, b) };
    }),
  });
  return actions;
}, async (rc) => ({
  sources: opts(FEEDBACK_SOURCES, LABEL),
  statuses: opts(FEEDBACK_STATUS, LABEL),
  themes: await feedbackThemes(rc.env, rc.projectId),
  roadmap_items: await roadmapItems(rc.env, rc.projectId),
}));

// ── Distribution — id: the channel's uid ────────────────────────────────────

const CHANNEL_EDIT = ['name', 'kind', 'state', 'cac_bar_cents', 'bar_currency', 'spend_cents'] as const;

const distribution = spec('growth_channels', 'distribution', GROW_OLD_ROWS.distribution, async (rc, id) => {
  const ch = await rc.env.DB.prepare('SELECT * FROM growth_channels WHERE uid = ? AND project_id = ?').bind(id, rc.projectId).first<Any>();
  if (!ch) throw vanished();
  const row = (await channelRows(growCtx(rc))).find((r) => r.uid === id) ?? null;
  const cacReason = row?.cac_reason ? row.cac_reason.replace(/^Not recorded: /, '') : 'Not recorded';
  return keep({
    title: String(ch.name),
    sub: joined(ch.kind ? label(ch.kind) : null, `utm_source=${ch.utm_source}`, label(ch.state)),
    pills: [pill(ch.state), ...(ch.kind ? [{ text: label(ch.kind), tone: 'vio' }] : [])],
    facts: [
      // The channel's spend and customers for the calendar month, as its list row and card count them.
      fact('Spend · 30 d', money(row?.spend_cents), 'No spend entered this month'),
      fact('Customers', row ? row.customers : null, 'Not recorded'),
      fact('CAC', money(row?.cac_cents), cacReason),
      fact('Bar', ch.cac_bar_cents != null ? `under ${money(ch.cac_bar_cents, ch.bar_currency)}` : null, 'No bar set'),
    ],
    createdBy: ch.created_by, createdAt: ch.created_at,
  }, { ch, row });
}, [
  section('funnel', 'Funnel', async (rc, _id, record) => {
    const { ch, row } = loadedOf(record);
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
    const res = await rc.env.DB.prepare('SELECT utm_json FROM contacts WHERE project_id = ? AND utm_json IS NOT NULL AND created_at >= ?')
      .bind(rc.projectId, since).all<{ utm_json: string }>();
    const signups = (res.results || []).filter((c) => utmSource(c.utm_json) === ch.utm_source).length;
    return { rows: [
      notRecorded('Visits', 'No per-channel visit count'), // D6107: PostHog visits are venture-wide, on the Distribution card
      { a: 'Sign-ups', b: 'contacts from this channel, last 30 days', c: String(signups) },
      { a: 'Paying', b: 'customers from this channel this month', c: String(row?.customers ?? 0) },
    ] };
  }),
  section('experiments', 'Experiments', async (rc, _id, record) => {
    const { ch } = loadedOf(record);
    const res = await rc.env.DB.prepare(
      'SELECT title, run_on, cac_cents, currency FROM channel_experiments WHERE channel_id = ? ORDER BY COALESCE(run_on, created_at) DESC, id DESC LIMIT 20',
    ).bind(ch.id).all<Any>();
    return { rows: (res.results || []).map((e) => ({ a: String(e.title), b: dMon(e.run_on) ?? '', c: money(e.cac_cents, e.currency) ?? '' })),
      empty: 'No experiment recorded.', action: 'add-experiment' };
  }),
  section('customers-acquired', 'Customers acquired', async (rc, _id, record) => {
    const { ch } = loadedOf(record);
    const month = new Date().toISOString().slice(0, 7);
    const res = await rc.env.DB.prepare(
      "SELECT name, utm_json FROM contacts WHERE project_id = ? AND audience = 'customer' AND utm_json IS NOT NULL AND substr(created_at, 1, 7) = ? ORDER BY id DESC",
    ).bind(rc.projectId, month).all<{ name: string | null; utm_json: string }>();
    const mine = (res.results || []).filter((c) => utmSource(c.utm_json) === ch.utm_source);
    if (!mine.length) return { rows: [], empty: 'No customer attributed to this channel this month.' };
    // Names to writers, a count to everyone else (decision 9).
    if (!await isWriter(rc)) return { rows: [{ a: plural(mine.length, 'customer', 'customers'), b: 'this month' }] };
    return { rows: mine.slice(0, 20).map((c) => ({ a: c.name || 'A customer with no name', b: 'this month' })) };
  }, { side: true }),
], async (rc, id, record): Promise<RecordAction[]> => {
  const { ch } = loadedOf(record);
  const actions: RecordAction[] = [];
  if (ch.state !== 'paused') {
    actions.push({ key: 'pause', label: 'Pause', kind: 'write', confirm: { title: `Pause ${ch.name}?`, cta: 'Pause' },
      execute: (c) => refusing(async () => ({ ok: true, record: await updateChannel(c.env, c.projectId, userOf(c), id, { state: 'paused' }) })) });
  }
  actions.push({
    key: 'add-experiment', label: 'Add experiment', kind: 'form',
    form: { title: 'Add experiment', cta: 'Add', fields: [
      { key: 'title', label: 'Experiment', kind: 'T', required: true, placeholder: '[What you tried]' },
      { key: 'run_on', label: 'Run on', kind: 'T', input: 'date' },
      { key: 'cac_cents', label: 'CAC', kind: 'T', input: 'money' },
      { key: 'currency', label: 'Currency', kind: 'T', placeholder: 'usd' },
    ] },
    execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await addExperiment(c.env, c.projectId, userOf(c), id, plain(body)) })),
  }, {
    key: 'edit', label: 'Edit', kind: 'form', tone: 'primary',
    form: { title: 'Edit channel', cta: 'Save', fields: [
      { key: 'name', label: 'Channel', kind: 'T', value: ch.name, required: true },
      { key: 'kind', label: 'Kind', kind: 'CH', value: ch.kind ?? '', options: opts(CHANNEL_KINDS, LABEL) },
      { key: 'state', label: 'State', kind: 'CH', value: ch.state, options: opts(CHANNEL_STATES, LABEL) },
      { key: 'cac_bar_cents', label: 'Strong when CAC under', kind: 'T', input: 'money', value: ch.cac_bar_cents ?? '' },
      { key: 'bar_currency', label: 'Currency', kind: 'T', value: ch.bar_currency ?? '' },
      { key: 'spend_cents', label: 'Spend this month', kind: 'T', input: 'money', value: loadedOf(record).row?.spend_cents ?? '' },
    ] },
    execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await updateChannel(c.env, c.projectId, userOf(c), id, pick(body, CHANNEL_EDIT)) })),
  });
  return actions;
}, async () => ({ kinds: opts(CHANNEL_KINDS, LABEL), states: opts(CHANNEL_STATES, LABEL) }));

// ── Revenue and traction — id: the KPI key ──────────────────────────────────

/** Worked out by the platform, never typed (decision 4). */
const DERIVED = new Set(['new_mrr', 'expansion_mrr', 'runway', 'arr', 'burn_multiple']);
const DERIVED_REASON: Record<string, string> = {
  new_mrr: 'New MRR is worked out from the revenue ledger.',
  expansion_mrr: 'Expansion MRR is worked out from the revenue ledger.',
  runway: 'Runway is worked out from cash and burn.',
  arr: 'ARR is worked out as 12 × MRR.',
  burn_multiple: 'Burn multiple is worked out from burn and the ledger\'s net new ARR.',
};

export function kpiValueText(value: number | null, unit: string | null): string | null {
  if (value == null) return null;
  if (unit === 'usd') return `$${Math.round(value).toLocaleString('en-US')}`;
  if (unit === 'usd_cents') return money(value);
  if (unit === 'pct') return `${Math.round(value * 100) / 100}%`;
  if (unit === 'months') return `${Math.round(value * 10) / 10} months`;
  if (unit === 'multiple') return `${Math.round(value * 100) / 100}×`;
  return Number(value).toLocaleString('en-US');
}
const signed = (text: string | null, v: number) => (text == null ? null : v > 0 ? `+${text}` : v < 0 ? `−${text.replace(/^-/, '')}` : text);

/** The KPI by month, newest first, the last twelve: the last value each month held (`kpiMonths`, D6103). */
async function kpiHistory(rc: RecordContext, row: KpiRow): Promise<Array<{ month: string; text: string }>> {
  return (await kpiMonths(rc.env, rc.projectId, row)).slice(0, 12)
    .map(({ month, value }) => ({ month, text: kpiValueText(value, row.unit) ?? '' }));
}

/** A typed KPI's own unit, for an entry when the KPI row reads Not recorded. */
const ENTRY_UNIT: Record<string, string> = { mrr: 'usd', paying_accounts: 'count', churn: 'pct', net_burn: 'usd' };
/** What a KPI's History lists entries of: a typed or custom KPI, unless Churn reads the ledger. */
const listsEntries = (row: KpiRow) => (row.id in ENTRY_UNIT && !(row.id === 'churn' && row.unit === 'usd_cents')) || row.id.startsWith(CUSTOM_PREFIX);
const HISTORY_ROWS = 24;

/**
 * D6101 (#6101): History as entries, newest first, for a KPI a person can type:
 * each hand entry with its day and a Remove, and a connected source's last
 * figure each month (it writes one a day). Null for a derived or PostHog KPI,
 * which keeps its months.
 */
async function historyEntries(rc: RecordContext, row: KpiRow): Promise<Row[] | null> {
  if (!listsEntries(row)) return null;
  const unit = row.unit ?? ENTRY_UNIT[row.id] ?? (await customKpis(rc.env, rc.projectId)).find((k) => `${CUSTOM_PREFIX}${k.uid}` === row.id)?.unit ?? null;
  const shown = unit === 'money' ? 'usd_cents' : unit;
  const months = new Set<string>();
  const rows: Row[] = [];
  for (const e of await kpiEntries(rc.env, rc.projectId, row.id)) {
    if (!e.manual) {
      const month = `${e.source}:${e.day.slice(0, 7)}`;
      if (months.has(month)) continue;
      months.add(month);
    }
    rows.push({ a: e.day, b: kpiValueText(e.value, shown) ?? '', c: e.manual ? 'By hand' : e.source, tone: e.manual ? 'grey' : 'vio',
      ...(e.manual ? { action: { key: 'remove-entry', body: { entry: e.entry } } } : {}) });
    if (rows.length >= HISTORY_ROWS) break;
  }
  return rows;
}

const revenue = spec('grow_kpis', 'revenue-and-traction', undefined, async (rc, id) => {
  await ensureProjectMetricsSchema(rc.env);
  const row = (await kpiRows(rc.env, rc.projectId, Date.now())).find((r) => r.id === id);
  if (!row) throw vanished();
  const notYet = row.reason ? row.reason.replace(/^Not recorded: /, '') : 'Not recorded';
  const change = row.change_30d == null ? null : signed(kpiValueText(Math.abs(row.change_30d), row.unit), row.change_30d);
  return keep({
    title: row.kpi,
    sub: row.value == null ? notYet : joined(kpiValueText(row.value, row.unit), row.source, row.as_of ? `as of ${dMon(row.as_of)}` : null),
    // D1608: a PostHog row's chip and source say so; it is never entered by hand.
    pills: [row.source ? { text: row.source === 'posthog' ? 'From PostHog' : row.source, tone: row.source === 'manual' ? 'grey' : 'vio' } : { text: id.startsWith('posthog-') ? 'From PostHog' : 'Not recorded', tone: 'grey' }],
    facts: [
      fact('Value', kpiValueText(row.value, row.unit), notYet),
      fact('Change · 30 d', change, row.value == null ? notYet : 'No value 30 days before'),
      fact('Source', id.startsWith('posthog-') ? 'From PostHog. This figure comes from PostHog.' : row.source, notYet),
      fact('As of', row.as_of, notYet),
    ],
  }, { row });
}, [
  section('history', 'History', async (rc, _id, record) => {
    const { row } = loadedOf(record);
    const entries = await historyEntries(rc, row);
    if (entries) return { rows: entries, empty: 'Not recorded yet.' };
    const months = await kpiHistory(rc, row);
    return { rows: months.map((m) => ({ a: m.month, b: m.text })), empty: 'Not recorded yet.' };
  }),
  section('split', 'Split', async (rc) => {
    const ledger = await readRecurring(rc.env, rc.projectId);
    if (billingPeriods(ledger) < 2) return { rows: [], empty: 'Not recorded: needs 2 billings.' };
    const gap = movementGap(ledger);
    if (gap) return { rows: [], empty: `${gap}.` };
    const mv = computeMovements(ledger);
    const latest = mv.length ? mv[mv.length - 1].month : null;
    const at = (kind: string) => mv.find((m) => m.month === latest && m.kind === kind) ?? null;
    return { rows: (['new', 'expansion', 'churned'] as const).map((kind) => {
      const m = at(kind);
      const name = kind === 'new' ? 'New' : kind === 'expansion' ? 'Expansion' : 'Churned';
      return m ? { a: name, b: latest ?? '', c: money(m.amount_cents) ?? '' }
        : notRecorded(name, at('unsplit') ? 'The ledger cannot tell new from expansion this month' : `None in ${latest}`);
    }) };
  }),
  section('alerts', 'Alerts', async (rc, id, record) => {
    const { row } = loadedOf(record);
    const res = await rc.env.DB.prepare(
      'SELECT id, uid, kpi_key, measure, op, threshold, threshold_cents, created_by, last_crossed_at FROM kpi_alerts WHERE project_id = ? AND kpi_key = ? ORDER BY id',
    ).bind(rc.projectId, id).all<KpiAlert>();
    return { rows: (res.results || []).map((a) => ({ a: alertText(row.kpi, a), c: a.last_crossed_at ? 'Crossed' : 'Not crossed', tone: a.last_crossed_at ? 'bad' : 'grey' })),
      empty: 'No alert set.', action: 'set-alert' };
  }, { side: true }),
  // There is no public metrics page (decision 10).
  section('shared', 'Shared', async () => ({ rows: [notRecorded('Metrics page', 'There is no public metrics page')] }), { side: true }),
], async (_rc, id, record): Promise<RecordAction[]> => {
  const { row } = loadedOf(record) as { row: KpiRow };
  const moneyKpi = row.unit === 'usd' || row.unit === 'usd_cents';
  const actions: RecordAction[] = [];
  // D1608: a PostHog metric is read from PostHog only, so it has no Enter by hand.
  if (!DERIVED.has(id) && !id.startsWith('posthog-')) {
    actions.push({
      key: 'enter-by-hand', label: 'Enter by hand', kind: 'form', tone: 'primary',
      form: { title: `Enter ${row.kpi}`, cta: 'Save', foot: 'A connected source overrides a hand entry.', fields: [
        { key: 'value', label: row.kpi, kind: 'T', input: moneyKpi && row.unit === 'usd_cents' ? 'money' : undefined, required: true,
          note: row.unit === 'usd' ? 'US dollars.' : row.unit === 'pct' ? 'A percentage.' : undefined },
        { key: 'as_of', label: 'As of', kind: 'T', input: 'date', required: true },
        { key: 'note', label: 'Note', kind: 'T' },
      ] },
      execute: (c, _id, body) => refusing(async () => {
        await ensureProjectMetricsSchema(c.env);
        const out = await enterKpi(c.env, c.projectId, Number(c.user.id), { kpi: id, value: field(body, 'value'), as_of: field(body, 'as_of'), note: field(body, 'note') });
        await logGrowWrite(c.env, c.projectId, Number(c.user.id), { module: 'revenue-and-traction', entityId: out.id, action: 'grow_kpi_entered', summary: `KPI entered for ${out.as_of}` });
        return { ok: true, record: out };
      }),
    });
  }
  // D6101 (#6101): a hand entry's Remove, run from its History row (`row_only`: no header button).
  if (listsEntries(row)) {
    actions.push({
      key: 'remove-entry', label: 'Remove', kind: 'write', tone: 'danger', row_only: true,
      confirm: { title: `Remove this ${row.kpi} entry?`, cta: 'Remove',
        body: `For a figure typed with the wrong value: ${row.kpi} then reads the next latest value, here, on the Overview and in a report draft. A report already sent keeps its figures.` },
      execute: (c, _id, body) => refusing(async () => {
        await ensureProjectMetricsSchema(c.env);
        const out = await removeKpiEntry(c.env, c.projectId, id, field(body, 'entry'));
        await logGrowWrite(c.env, c.projectId, Number(c.user.id), { module: 'revenue-and-traction', entityId: out.id, action: 'grow_kpi_entry_removed',
          summary: `Hand entry removed: ${kpiValueText(out.value, ENTRY_UNIT[out.id] ?? row.unit) ?? out.value} for ${out.as_of}` });
        return { ok: true, record: out };
      }),
    });
  }
  actions.push({
    key: 'set-alert', label: 'Set an alert', kind: 'form',
    form: { title: `Alert on ${row.kpi}`, cta: 'Set alert', foot: 'You are told in the app once when it crosses, and again only after it crosses back.', fields: [
      { key: 'measure', label: 'Watch', kind: 'CH', value: 'value', options: opts(ALERT_MEASURES, LABEL) },
      { key: 'op', label: 'When it goes', kind: 'CH', value: 'below', options: opts(ALERT_OPS, LABEL), required: true },
      moneyKpi
        ? { key: 'threshold_cents', label: 'Amount', kind: 'T', input: 'money', note: 'For a change over 30 days, use Threshold instead.' }
        : { key: 'threshold', label: 'Threshold', kind: 'T', required: true },
      ...(moneyKpi ? [{ key: 'threshold', label: 'Threshold (%)', kind: 'T', note: 'For a change over 30 days.' } as RecordField] : []),
    ] },
    execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await setKpiAlert(c.env, c.projectId, userOf(c), id, plain(body)) })),
  });
  return actions;
}, async (rc) => {
  const custom = await customKpis(rc.env, rc.projectId);
  const stripe = await rc.env.DB.prepare(
    `SELECT 1 FROM integrations i JOIN users u ON u.id = i.user_id JOIN projects p ON p.founder_id = u.founder_id
      WHERE p.id = ? AND i.provider_key = 'stripe' AND i.status = 'active' LIMIT 1`,
  ).bind(rc.projectId).first().catch(() => null);
  // Chips, as D695's Enter a KPI reads them (`optionsFrom`): a derived KPI and an unconnected source are drawn disabled, with why.
  return {
    kpis: [...KPI_KEYS.map((k) => ({ value: k, label: KPI_LABEL[k], enterable: !DERIVED.has(k), disabled: DERIVED.has(k), reason: DERIVED_REASON[k] ?? null })),
      ...custom.map((k) => ({ value: `${CUSTOM_PREFIX}${k.uid}`, label: k.label, enterable: true, disabled: false, reason: null })),
      { value: 'custom', label: 'Custom', enterable: true, disabled: false, reason: null }],
    custom: custom.map((k) => ({ value: `${CUSTOM_PREFIX}${k.uid}`, label: k.label, unit: k.unit })),
    units: [...CUSTOM_UNITS],
    sources: [
      { value: 'manual', label: 'Entered by hand', disabled: false, reason: null },
      { value: 'stripe', label: 'Stripe', disabled: !stripe, state: stripe ? 'connected' : 'not_connected',
        reason: stripe ? 'Connected: its figures override a hand entry.' : 'Stripe is not connected.' },
      { value: 'accounting', label: 'Accounting', disabled: true, reason: 'No accounting connector writes KPIs yet.' },
      { value: 'bank', label: 'Bank', disabled: true, reason: 'No bank connector writes KPIs yet.' },
    ],
    measures: opts(ALERT_MEASURES, LABEL),
    ops: opts(ALERT_OPS, LABEL),
  };
});

// ── Team expansion — id: the posting's id ───────────────────────────────────

const ROLE_TEAMS = ['Engineering', 'Product', 'Go-to-market', 'Operations'];
/** #6110: how many applicants the record lists; the rest are on the jobs board's own page. */
export const APPLICANTS_SHOWN = 50;
/** A non-host's count line: "1 at interview · 1 at offer · 2 hired". */
const COUNT_WORD: Record<string, string> = { applied: 'applied', screen: 'at screen', interview: 'at interview', offer: 'at offer', hired: 'hired', declined: 'declined' };
const ROLE_EDIT = ['title', 'team', 'target_start', 'type', 'comp_min_cents', 'comp_max_cents', 'comp_currency', 'equity_pct'] as const;

const teamExpansion = spec('job_postings', 'team-expansion', GROW_OLD_ROWS['team-expansion'], async (rc, id) => {
  const p = await rc.env.DB.prepare('SELECT * FROM job_postings WHERE id = ? AND project_id = ?').bind(Number(id), rc.projectId).first<Any>();
  if (!p) throw vanished();
  const res = await rc.env.DB.prepare('SELECT stage, COUNT(*) AS n FROM job_applications WHERE posting_id = ? GROUP BY stage').bind(p.id).all<{ stage: string; n: number }>();
  const stages = new Map((res.results || []).map((r) => [String(r.stage), Number(r.n)]));
  const applicants = [...stages.values()].reduce((a, b) => a + b, 0);
  return keep({
    title: String(p.title),
    sub: joined(p.team, label(p.employment_type), label(p.status)),
    pills: [pill(p.status), { text: label(p.employment_type), tone: 'grey' }],
    facts: [
      fact('Team', p.team, 'No team set'),
      fact('Applicants', applicants, ''),
      fact('In interview', stages.get('interview') ?? 0, ''),
      fact('Target start', p.target_start, 'No target start set'),
    ],
    createdBy: p.host_user_id, createdAt: p.created_at,
  }, { p, stages });
}, [
  // #6110 (D6110): every stage of APPLICATION_STAGES, Hired and Declined included, so a move shows in the counts.
  section('pipeline', 'Pipeline', async (_rc, _id, record) => {
    const { stages } = loadedOf(record);
    return { rows: APPLICATION_STAGES.map((s) => ({ a: label(s), c: String(stages.get(s) ?? 0) })) };
  }),
  // #6110 (D6110): every applicant the host may see, each with Move to… (`move-applicant`). Names stay the host's.
  section('shortlist', 'Shortlist', async (rc, _id, record) => {
    const { p, stages } = loadedOf(record);
    const total = [...(stages as Map<string, number>).values()].reduce((a, b) => a + Number(b), 0);
    if (!total) return { rows: [], empty: 'Nobody has applied yet.' };
    // Applicant names follow the jobs board's canManage (decision 9); everyone else sees counts.
    if (!managesPosting(rc, p.host_user_id)) {
      const counts = APPLICATION_STAGES.filter((s) => Number(stages.get(s) ?? 0) > 0).map((s) => `${stages.get(s)} ${COUNT_WORD[s]}`);
      return { rows: [{ a: joined(...counts), b: 'names are for the role\'s host' }] };
    }
    const res = await rc.env.DB.prepare(
      `SELECT id, name, stage FROM job_applications WHERE posting_id = ?
        ORDER BY CASE stage WHEN 'offer' THEN 0 WHEN 'interview' THEN 1 WHEN 'screen' THEN 2 WHEN 'applied' THEN 3 WHEN 'hired' THEN 4 ELSE 5 END,
                 stage_changed_at DESC, id DESC LIMIT ?`,
    ).bind(p.id, APPLICANTS_SHOWN + 1).all<{ id: number; name: string | null; stage: string }>();
    const all = res.results || [];
    const rows: Row[] = all.slice(0, APPLICANTS_SHOWN).map((a) => ({
      a: a.name || 'An applicant with no name',
      // On Hired, the way to the team roster; nothing is written there on its own.
      ...(a.stage === 'hired' ? { b: 'Add to the team roster', href: '/build/team' } : {}),
      c: label(a.stage), tone: a.stage === 'offer' || a.stage === 'hired' ? 'ok' : a.stage === 'declined' ? 'grey' : 'vio',
      action: { key: 'move-applicant', body: { application_id: Number(a.id) } },
    }));
    if (all.length > APPLICANTS_SHOWN) rows.push({ a: `${total - APPLICANTS_SHOWN} more applicants`, b: 'on the jobs board', href: `/jobs/${p.id}/manage` });
    return { rows };
  }),
  section('compensation', 'Compensation', async (_rc, _id, record) => {
    const { p } = loadedOf(record);
    const lo = money(p.comp_min_cents, p.comp_currency); const hi = money(p.comp_max_cents, p.comp_currency);
    const band = lo && hi ? `${lo}–${hi}` : lo ? `from ${lo}` : hi ? `up to ${hi}` : null;
    return { rows: [
      band ? { a: 'Band', b: band } : notRecorded('Band', 'No band on this role'),
      p.equity_pct != null ? { a: 'Equity', b: `${Number(p.equity_pct)}%` } : notRecorded('Equity', 'No equity on this role'),
      ...(band ? [{ a: 'Jobs board', b: Number(p.comp_public) === 1 ? 'Band shown' : 'Band not shown' }] : []),
    ] };
  }, { side: true }),
  section('posted-on', 'Posted on', async (rc, _id, record) => {
    const { p } = loadedOf(record);
    // LinkedIn is not drawn (D-q); applicants are reviewed on the board's own page.
    return { rows: [{ a: 'Axal jobs board', b: label(p.status), tone: TONE[String(p.status)], ...(managesPosting(rc, p.host_user_id) ? { href: `/jobs/${p.id}/manage` } : {}) }] };
  }, { side: true }),
], async (rc, id, record): Promise<RecordAction[]> => {
  const { p } = loadedOf(record);
  const manages = managesPosting(rc, p.host_user_id);
  const actions: RecordAction[] = [];
  if (manages && p.status !== 'closed') {
    actions.push({ key: 'close-role', label: 'Close role', kind: 'write', tone: 'danger',
      confirm: { title: `Close ${p.title}?`, body: 'It leaves the jobs board.', cta: 'Close role' },
      execute: (c) => refusing(async () => ({ ok: true, record: await closeRole(c.env, c.projectId, userOf(c), Number(id)) })) });
  }
  // #6110 (D6110): the host moves one applicant, from that applicant's row. The row sends its id; the stage is chosen here.
  if (manages) {
    // The applicant is a field too, as Update an experiment's is, so the action also runs from the record's own
    // action row; a row's Move to… arrives with its applicant chosen (`recordFormFor` fills it from the row's body).
    const applicants = (await rc.env.DB.prepare(
      'SELECT id, name, stage FROM job_applications WHERE posting_id = ? ORDER BY name, id LIMIT 200',
    ).bind(p.id).all<{ id: number; name: string | null; stage: string }>()).results || [];
    if (applicants.length) actions.push({
      key: 'move-applicant', label: 'Move to…', kind: 'form',
      form: { title: 'Move an applicant', cta: 'Move', fields: [
        { key: 'application_id', label: 'Applicant', kind: 'CH', required: true,
          options: applicants.map((a) => ({ value: String(a.id), label: `${a.name || 'An applicant with no name'} · ${label(a.stage)}` })) },
        { key: 'stage', label: 'Move to', kind: 'CH', required: true, options: opts(APPLICATION_STAGES, LABEL) },
      ] },
      execute: (c, _id, body) => refusing(async () => {
        const applicationId = Number(field(body, 'application_id'));
        // The writer checks the venture only; the applicant must be on THIS role.
        const own = Number.isSafeInteger(applicationId) && applicationId > 0
          ? await c.env.DB.prepare('SELECT 1 AS ok FROM job_applications WHERE id = ? AND posting_id = ?').bind(applicationId, Number(id)).first()
          : null;
        if (!own) throw new Refused(404, 'That applicant is not on this role.', 'application_id');
        await setApplicationStage(c.env, c.projectId, userOf(c), applicationId, { stage: field(body, 'stage') });
        return { ok: true };
      }),
    });
  }
  const canPublish = manages && (p.status === 'draft' || p.status === 'rejected');
  const hasBand = p.comp_min_cents != null || p.comp_max_cents != null;
  actions.push({
    key: 'edit', label: 'Edit', kind: 'form', tone: 'primary',
    form: { title: 'Edit role', cta: 'Save', fields: [
      { key: 'title', label: 'Role', kind: 'T', value: p.title, required: true },
      { key: 'team', label: 'Team', kind: 'T', value: p.team ?? '' },
      { key: 'target_start', label: 'Target start', kind: 'T', value: p.target_start ?? '', placeholder: 'YYYY-MM or YYYY-MM-DD' },
      { key: 'type', label: 'Type', kind: 'CH', value: p.employment_type, options: opts(ROLE_TYPES, LABEL) },
      { key: 'comp_min_cents', label: 'Band from', kind: 'T', input: 'money', value: p.comp_min_cents ?? '' },
      { key: 'comp_max_cents', label: 'Band to', kind: 'T', input: 'money', value: p.comp_max_cents ?? '' },
      { key: 'comp_currency', label: 'Currency', kind: 'T', value: p.comp_currency ?? '' },
      { key: 'equity_pct', label: 'Equity (%)', kind: 'T', value: p.equity_pct ?? '' },
      // #2181: drawn only once the role has a band; off unless its founder turned it on.
      ...(hasBand ? [{ key: 'comp_public', label: 'Jobs board', kind: 'CK', value: Number(p.comp_public) === 1 ? ['1'] : [],
        options: [{ value: '1', label: 'Show the band on the jobs board' }] } as RecordField] : []),
      // Only the posting's host or an admin can send it for review (decision 6).
      ...(canPublish ? [{ key: 'publish', label: 'Send for review', kind: 'CK', value: [], options: [{ value: '1', label: 'Publish on the jobs board' }],
        note: 'An admin publishes it after review.' } as RecordField] : []),
    ] },
    execute: (c, _id, body) => refusing(async () => {
      const b = pick(body, ROLE_EDIT);
      if (hasBand) b.comp_public = checked(field(body, 'comp_public')) ? 1 : 0;
      // Passed on whoever sends it: `updateRole` refuses a non-host's publish with 403 and writes nothing.
      if (checked(field(body, 'publish'))) b.publish = true;
      return { ok: true, record: await updateRole(c.env, c.projectId, userOf(c), Number(id), b) };
    }),
  });
  return actions;
}, async (rc) => {
  const res = await rc.env.DB.prepare("SELECT DISTINCT team FROM job_postings WHERE project_id = ? AND team IS NOT NULL AND trim(team) <> '' ORDER BY team")
    .bind(rc.projectId).all<{ team: string }>();
  // The canvas's four, then any other team the venture's roles already name.
  const teams = [...new Set([...ROLE_TEAMS, ...(res.results || []).map((t) => String(t.team))])];
  return { teams: teams.map((t) => ({ value: t, label: t })), types: opts(ROLE_TYPES, LABEL) };
});

/** D6114 (#6114): a deal's and an agenda item's Edit send these keys only; each row is checked in its own store, then against its parent by the writer. */
const DEAL_EDIT = ['customer', 'closed_on', 'amount_cents', 'currency'] as const;
const AGENDA_EDIT = ['text', 'owner_name'] as const;
const dealRef = (body: Body): Array<{ store: Store; id: string | number }> => [{ store: 'growth_partner_deals', id: refOf(field(body, 'deal')) }];
const agendaRef = (body: Body): Array<{ store: Store; id: string | number }> => [{ store: 'obligation_agenda_items', id: refOf(field(body, 'item')) }];

// ── Partner network — id: the partner's uid ─────────────────────────────────

/** "Rev-share 20%", "Services fee · $4,000"; the old free text when no terms are typed (decision 7). */
export function termsText(g: Any): string | null {
  if (g.terms_kind == null) return g.terms ? String(g.terms) : null;
  if (g.terms_kind === 'none') return 'None yet';
  if (g.terms_pct != null) return `${label(g.terms_kind)} ${Number(g.terms_pct)}%`;
  const amount = money(g.terms_amount_cents, g.terms_currency);
  return amount ? `${label(g.terms_kind)} · ${amount}` : label(g.terms_kind);
}

/** "Oct 2026" for a stored YYYY-MM. */
function monthYear(raw: unknown): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(raw ?? ''));
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${month} ${m[1]}` : String(raw ?? '');
}

/**
 * D6112: Enter revenue's amount, in US dollars as typed ("1,200", "$40.50"), to cents through the money
 * layer (D5373); partner revenue carries no currency, and every reader shows it in dollars.
 */
function typedRevenueCents(v: unknown): number {
  const parsed = parseMinor(String(v ?? '').trim().replace(/^\$/, ''), 'USD');
  if (!parsed.ok) throw new Refused(400, 'Type an amount in US dollars, 0 or more', 'amount');
  return parsed.minor;
}

const PARTNER_EDIT = ['name', 'type', 'stage', 'terms', 'terms_kind', 'terms_pct', 'terms_amount_cents', 'terms_currency', 'renewal_on', 'contact_name', 'contact_email'] as const;

const partnerNetwork = spec('growth_partners', 'partner-network', GROW_OLD_ROWS['partner-network'], async (rc, id) => {
  const g = await rc.env.DB.prepare(
    'SELECT g.*, (SELECT SUM(amount_cents) FROM partner_revenue r WHERE r.partner_id = g.id) AS revenue_cents FROM growth_partners g WHERE g.uid = ? AND g.project_id = ?',
  ).bind(id, rc.projectId).first<Any>();
  if (!g) throw vanished();
  return keep({
    title: String(g.name),
    sub: joined(label(g.type), label(g.stage), g.renewal_on ? `renews ${dMon(g.renewal_on)}` : null),
    pills: [pill(g.stage), { text: label(g.type), tone: 'grey' }],
    facts: [
      fact('Type', label(g.type), ''),
      fact('Stage', label(g.stage), ''),
      fact('Terms', termsText(g), 'No terms recorded'),
      fact('Revenue sourced', money(g.revenue_cents), 'No partner revenue entered'),
    ],
    createdBy: g.created_by, createdAt: g.created_at,
  }, { g });
}, [
  section('deals', 'Deals sourced', async (rc, _id, record) => {
    const { g } = loadedOf(record);
    const res = await rc.env.DB.prepare(
      'SELECT uid, customer, closed_on, amount_cents, currency FROM growth_partner_deals WHERE partner_id = ? ORDER BY COALESCE(closed_on, created_at) DESC, id DESC LIMIT 20',
    ).bind(g.id).all<Any>();
    const writer = await isWriter(rc);
    // A deal's customer is a third party: named for writers, counted for everyone else.
    // D6114 (#6114): a writer's row names its deal by uid, with Edit (its own values) and Remove.
    return { rows: (res.results || []).map((d) => {
      const row: Row = { a: writer ? String(d.customer) : 'A deal', b: dMon(d.closed_on) ?? '', c: money(d.amount_cents, d.currency) ?? '' };
      if (!writer) return row;
      const deal = { deal: String(d.uid) };
      return { ...row, actions: [
        { key: 'edit-deal', body: deal, values: { customer: String(d.customer), closed_on: d.closed_on ?? '', amount_cents: d.amount_cents ?? '', currency: d.currency ?? '' } },
        { key: 'remove-deal', body: deal },
      ] };
    }), empty: 'No deal recorded.', action: 'add-deal' };
  }),
  // D6112 (#6112): each month's partner-sourced revenue with where it came from; a month no one entered has no row.
  section('revenue', 'Revenue by month', async (rc, _id, record) => {
    const { g } = loadedOf(record);
    const res = await rc.env.DB.prepare('SELECT month, amount_cents, source FROM partner_revenue WHERE partner_id = ? ORDER BY month DESC LIMIT 24')
      .bind(g.id).all<Any>();
    return { rows: (res.results || []).map((r) => ({ a: monthYear(r.month), b: partnerRevenueSource(r.source), c: money(r.amount_cents) ?? '' })),
      empty: 'No month entered.', action: 'enter-revenue' };
  }),
  section('terms', 'Terms', async (_rc, _id, record) => {
    const { g } = loadedOf(record);
    const terms = termsText(g);
    return { rows: [
      terms ? { a: 'Terms', b: terms } : notRecorded('Terms', 'No terms recorded'),
      g.renewal_on ? { a: 'Renewal', b: String(g.renewal_on) } : notRecorded('Renewal', 'No renewal date recorded'),
    ] };
  }),
  section('contact', 'Contact', async (_rc, _id, record) => {
    const { g } = loadedOf(record);
    const who = joined(g.contact_name, g.contact_email);
    return who ? { rows: [{ a: who }] } : { rows: [], empty: 'No contact recorded.' };
  }, { side: true, ...writersOnly }),
  // Introductions are not linked to partners (decision 10).
  section('introductions', 'Introductions', async () => ({ rows: [notRecorded('From Network', 'Introductions are not linked to partners')] }), { side: true }),
], async (_rc, id, record): Promise<RecordAction[]> => {
  const { g } = loadedOf(record);
  const actions: RecordAction[] = [];
  if (g.stage !== 'paused' && g.stage !== 'ended') {
    actions.push({ key: 'pause', label: 'Pause', kind: 'write', confirm: { title: `Pause ${g.name}?`, cta: 'Pause' },
      execute: (c) => refusing(async () => ({ ok: true, record: await updatePartner(c.env, c.projectId, userOf(c), id, { stage: 'paused' }) })) });
  }
  actions.push({
    key: 'enter-revenue', label: 'Enter revenue', kind: 'form',
    form: { title: 'Enter revenue', sub: 'Revenue this partner sourced in one month.', cta: 'Save',
      foot: 'A month already typed is replaced. A month that came from another source keeps its figure.', fields: [
        { key: 'month', label: 'Month', kind: 'T', placeholder: 'YYYY-MM', value: new Date().toISOString().slice(0, 7), required: true },
        { key: 'amount', label: 'Amount', kind: 'T', input: 'money', required: true, note: 'US dollars.' },
      ] },
    execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await setPartnerRevenue(c.env, c.projectId, userOf(c), id,
      String(field(body, 'month') ?? '').trim(), { amount_cents: typedRevenueCents(field(body, 'amount')) }) })),
  });
  actions.push({
    key: 'add-deal', label: 'Add deal', kind: 'form',
    form: { title: 'Add deal', cta: 'Add', fields: [
      { key: 'customer', label: 'Customer', kind: 'T', required: true },
      { key: 'closed_on', label: 'Closed on', kind: 'T', input: 'date' },
      { key: 'amount_cents', label: 'Amount', kind: 'T', input: 'money' },
      { key: 'currency', label: 'Currency', kind: 'T', placeholder: 'usd' },
    ] },
    execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await addPartnerDeal(c.env, c.projectId, userOf(c), id, plain(body)) })),
  }, {
    key: 'edit-deal', label: 'Edit', kind: 'form', row_only: true,
    references: dealRef,
    form: { title: 'Edit deal', cta: 'Save', fields: [
      { key: 'customer', label: 'Customer', kind: 'T', required: true },
      { key: 'closed_on', label: 'Closed on', kind: 'T', input: 'date' },
      { key: 'amount_cents', label: 'Amount', kind: 'T', input: 'money' },
      { key: 'currency', label: 'Currency', kind: 'T', placeholder: 'usd' },
    ] },
    execute: (c, _id, body) => refusing(async () => ({ ok: true,
      record: await updatePartnerDeal(c.env, c.projectId, userOf(c), id, field(body, 'deal'), pick(body, DEAL_EDIT)) })),
  }, {
    key: 'remove-deal', label: 'Remove', kind: 'write', tone: 'danger', row_only: true,
    confirm: { title: 'Remove this deal?', body: 'It leaves the deals this partner sourced. Activity keeps a line that a deal was removed, without the customer.', cta: 'Remove' },
    references: dealRef,
    execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await removePartnerDeal(c.env, c.projectId, userOf(c), id, field(body, 'deal')) })),
  }, {
    key: 'edit', label: 'Edit', kind: 'form', tone: 'primary',
    form: { title: 'Edit partner', cta: 'Save', foot: 'Terms are a percentage or an amount, not both.', fields: [
      { key: 'name', label: 'Partner', kind: 'T', value: g.name, required: true },
      { key: 'type', label: 'Type', kind: 'CH', value: g.type, options: opts(PARTNER_TYPES, LABEL) },
      { key: 'stage', label: 'Stage', kind: 'CH', value: g.stage, options: opts(PARTNER_STAGES, LABEL) },
      { key: 'terms_kind', label: 'Terms', kind: 'CH', value: g.terms_kind ?? '', options: opts(TERMS_KINDS, LABEL) },
      { key: 'terms_pct', label: 'Percentage', kind: 'T', value: g.terms_pct ?? '' },
      { key: 'terms_amount_cents', label: 'Amount', kind: 'T', input: 'money', value: g.terms_amount_cents ?? '' },
      { key: 'terms_currency', label: 'Currency', kind: 'T', value: g.terms_currency ?? '' },
      { key: 'renewal_on', label: 'Renewal', kind: 'T', input: 'date', value: g.renewal_on ?? '' },
      { key: 'contact_name', label: 'Contact', kind: 'T', value: g.contact_name ?? '' },
      { key: 'contact_email', label: 'Contact email', kind: 'T', input: 'email', value: g.contact_email ?? '' },
    ] },
    execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await updatePartner(c.env, c.projectId, userOf(c), id, pick(body, PARTNER_EDIT)) })),
  }, remove(`Remove ${g.name}?`, 'For a partner added by mistake: it leaves the partner list, its card and its counts. A partner with revenue or deals stays; end it instead.',
    (c) => removePartner(c.env, c.projectId, userOf(c), id)));
  return actions;
}, async () => ({ types: opts(PARTNER_TYPES, LABEL), stages: opts(PARTNER_STAGES, LABEL), terms_kinds: opts(TERMS_KINDS, LABEL) }));

// ── Market expansion — id: the market's uid ─────────────────────────────────

const MARKET_EDIT = ['state', 'decision', ...MARKET_PARTS.flatMap(([k]) => [`${k}_score`, `${k}_source`]), 'geography_ref', 'size_cents', 'size_currency', 'size_source'] as const;
const marketDecisions = [{ value: '', label: 'Not decided' }, ...opts(DECISIONS, LABEL)];

async function marketGeographies(rc: RecordContext) {
  const res = await rc.env.DB.prepare('SELECT code, name FROM research_countries ORDER BY name').all<{ code: string; name: string }>().catch(() => null);
  return (res?.results ?? []).map(({ code, name }) => ({ value: code, label: name }));
}

/** D6113 (#6113): an entry step's Edit sends these keys only. */
const ENTRY_STEP_EDIT = ['text', 'owner_name', 'due_on'] as const;
/** The step a row names is checked in its own store (the venture's), then against this market by the writer. */
const stepRef = (body: Body): Array<{ store: Store; id: string | number }> => [{ store: 'market_entry_steps', id: refOf(field(body, 'step')) }];

/**
 * D6120 (#6120, GR-22, GR-27): the market record's own values, unformatted, for the Markets record page: each
 * part's score and source, readiness, the decision and its day, the attached country, the size, the entry steps
 * (with due and done days, so the page can say Overdue), the localisation checks and the replies to a market ask.
 * Each store is read on its own: a failed one is `null` with its `*_state` 'unreadable', never an empty list.
 */
async function marketParts(rc: RecordContext, m: Any, rd: ReturnType<typeof readiness>) {
  const read = async <T>(run: () => Promise<T>): Promise<T | null> => { try { return await run(); } catch { return null; } };
  const steps = await read(async () => ((await rc.env.DB.prepare(
    'SELECT uid, text, owner_name, due_on, done_at FROM market_entry_steps WHERE market_id = ? ORDER BY COALESCE(due_on, created_at), id LIMIT 30',
  ).bind(m.id).all<Any>()).results || []).map((x) => ({ uid: String(x.uid), text: String(x.text), owner_name: x.owner_name ?? null, due_on: x.due_on ?? null, done_at: x.done_at ?? null })));
  const stepsTotal = await read(async () => Number((await rc.env.DB.prepare('SELECT COUNT(*) AS n FROM market_entry_steps WHERE market_id = ?').bind(m.id).first<{ n: number }>())?.n ?? 0));
  const ticks = await read(async () => new Map(((await rc.env.DB.prepare('SELECT key, done_at FROM market_localisation WHERE market_id = ?')
    .bind(m.id).all<{ key: string; done_at: string | null }>()).results || []).map((r) => [r.key, r.done_at])));
  // A country read that fails is `false`; one the store no longer lists is `null` (the code is kept and shown).
  const country = m.geography_ref ? await read(async () => (await rc.env.DB.prepare('SELECT code, name, region FROM research_countries WHERE code = ?')
    .bind(m.geography_ref).first<{ code: string; name: string; region: string | null }>()) ?? undefined).then((c) => (c === null ? false : c ?? null)) : null;
  const replies = await read(async () => ((await rc.env.DB.prepare(
    `SELECT r.uid, r.name, r.message, r.created_at FROM update_ask_replies r
       JOIN update_asks a ON a.id = r.ask_id JOIN portfolio_updates u ON u.id = a.update_id
      WHERE u.project_id = ? AND a.kind = 'market' AND a.link_ref = CAST(? AS TEXT) ORDER BY r.id DESC LIMIT 20`,
  ).bind(rc.projectId, m.id).all<Any>()).results || []).map((x) => ({ uid: String(x.uid), name: x.name ?? null, message: x.message ?? null, created_at: x.created_at ?? null })));
  // D8251 (#8251, GR-24): Eadwyn's open proposals on this market, newest first; a failed read is `proposals: null`.
  const proposals = await read(async () => ((await rc.env.DB.prepare(
    `SELECT uid, kind, payload, sources, created_at FROM market_proposals WHERE market_id = ? AND state = 'proposed' ORDER BY id DESC LIMIT 20`,
  ).bind(m.id).all<Any>()).results || []).map((x) => ({ uid: String(x.uid), kind: String(x.kind), payload: JSON.parse(String(x.payload)), sources: JSON.parse(String(x.sources)), created_at: x.created_at ?? null })));
  return {
    state: m.state, decision: m.decision ?? null, decided_on: m.decided_on ?? null,
    scores: MARKET_PARTS.map(([k, l]) => ({ key: k, part: l, score: m[`${k}_score`] ?? null, source: m[`${k}_source`] ?? null })),
    readiness: rd.score, missing: rd.missing, weakest: rd.weakest,
    geography_ref: m.geography_ref ?? null,
    country: country ? { code: country.code, name: country.name, region: country.region ?? null } : null,
    country_state: !m.geography_ref ? 'none' : country === false ? 'unreadable' : country ? 'ok' : 'unlisted',
    size: m.size_cents != null ? { cents: m.size_cents, currency: m.size_currency ?? null, source: m.size_source ?? null } : null,
    steps, steps_total: stepsTotal, steps_state: steps && stepsTotal != null ? 'ok' : 'unreadable',
    localisation: ticks ? LOCALISATION_KEYS.map((k) => ({ key: k, label: label(k), done_at: ticks.get(k) ?? null })) : null,
    localisation_state: ticks ? 'ok' : 'unreadable',
    replies, replies_state: replies ? 'ok' : 'unreadable',
    proposals, proposals_state: proposals ? 'ok' : 'unreadable',
  };
}

const marketExpansion = spec('markets', 'market-expansion', GROW_OLD_ROWS['market-expansion'], async (rc, id) => {
  const m = await rc.env.DB.prepare('SELECT * FROM markets WHERE uid = ? AND project_id = ?').bind(id, rc.projectId).first<Any>();
  if (!m) throw vanished();
  const rd = readiness(m as MarketRow);
  const part = (k: string, l: string) => fact(l, m[`${k}_score`] != null ? `${m[`${k}_score`]} / 10 · ${m[`${k}_source`]}` : null, 'No source yet');
  return keep({
    title: String(m.name),
    sub: joined(label(m.state), rd.score != null ? `readiness ${rd.score} / 40` : 'readiness not scored', m.decision ? label(m.decision) : null),
    pills: [pill(m.state), ...(m.decision ? [{ text: label(m.decision), tone: m.decision === 'enter' ? 'ok' : 'grey' }] : [])],
    facts: [part('demand', 'Demand evidence'), part('regulation', 'Regulation'), part('partners', 'Partners'), part('cost', 'Cost to enter')],
    createdBy: m.created_by, createdAt: m.created_at,
    parts: { market: await marketParts(rc, m, rd) },
  }, { m });
}, [
  section('entry-plan', 'Entry plan', async (rc, _id, record) => {
    const { m } = loadedOf(record);
    const res = await rc.env.DB.prepare('SELECT uid, text, owner_name, due_on, done_at FROM market_entry_steps WHERE market_id = ? ORDER BY COALESCE(due_on, created_at), id LIMIT 30')
      .bind(m.id).all<Any>();
    // D6113 (#6113): each step names itself by uid, so Mark done or Reopen, Edit and Remove address it.
    return { rows: (res.results || []).map((s) => {
      const step = { step: String(s.uid) };
      return {
        a: String(s.text), b: joined(s.owner_name, dMon(s.due_on)), c: s.done_at ? 'Done' : 'Open', tone: s.done_at ? 'ok' : 'amb',
        action: { key: s.done_at ? 'reopen-entry-step' : 'mark-entry-step-done', body: step },
        actions: [
          { key: 'edit-entry-step', body: step, values: { text: String(s.text), owner_name: s.owner_name ?? '', due_on: s.due_on ?? '' } },
          { key: 'remove-entry-step', body: step },
        ],
      };
    }), empty: 'No entry step recorded.', action: 'add-entry-step' };
  }),
  section('localisation', 'Localisation', async (rc, _id, record) => {
    const { m } = loadedOf(record);
    const res = await rc.env.DB.prepare('SELECT key, done_at FROM market_localisation WHERE market_id = ?').bind(m.id).all<{ key: string; done_at: string | null }>();
    const done = new Map((res.results || []).map((r) => [r.key, !!r.done_at]));
    return { rows: LOCALISATION_KEYS.map((k) => ({ a: label(k), c: done.get(k) ? 'Done' : 'Open', tone: done.get(k) ? 'ok' : 'amb',
      action: { key: 'localisation-check', body: { key: k, done: !done.get(k) } } })) };
  }),
  section('attached', 'Attached', async (rc, _id, record) => {
    const { m } = loadedOf(record);
    if (!m.geography_ref) return { rows: [], empty: 'No Research › Geographies country attached.' };
    const c = await rc.env.DB.prepare('SELECT code, name FROM research_countries WHERE code = ?').bind(m.geography_ref).first<{ code: string; name: string }>().catch(() => null);
    return { rows: [{ a: c?.name ?? String(m.geography_ref), b: 'Research › Geographies', href: `/research/geographies/${encodeURIComponent(String(m.geography_ref))}` }] };
  }, { side: true }),
  section('sizing', 'Sizing', async (_rc, _id, record) => {
    const { m } = loadedOf(record);
    const size = money(m.size_cents, m.size_currency);
    return { rows: [size ? { a: 'Size', b: size, c: m.size_source ?? '' } : notRecorded('Size', 'No size recorded')] };
  }, { side: true }),
], async (rc, id, record): Promise<RecordAction[]> => {
  const { m } = loadedOf(record);
  const countries = await marketGeographies(rc);
  const part = (k: string, l: string): RecordField[] => [
    { key: `${k}_score`, label: `${l} (0–10)`, kind: 'T', value: m[`${k}_score`] ?? '' },
    { key: `${k}_source`, label: `${l} source`, kind: 'T', value: m[`${k}_source`] ?? '' },
  ];
  return [{
    key: 'change-decision', label: 'Change decision', kind: 'form',
    form: { title: 'Change decision', cta: 'Save', fields: [
      { key: 'decision', label: 'Decision', kind: 'CH', value: m.decision ?? '', options: marketDecisions },
    ] },
    execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await updateMarket(c.env, c.projectId, userOf(c), id, { decision: field(body, 'decision') ?? null }) })),
  }, {
    key: 'add-entry-step', label: 'Add entry step', kind: 'form',
    form: { title: 'Add entry step', cta: 'Add', fields: [
      { key: 'text', label: 'Step', kind: 'T', required: true },
      { key: 'owner_name', label: 'Owner', kind: 'T' },
      { key: 'due_on', label: 'Due', kind: 'T', input: 'date' },
    ] },
    execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await addEntryStep(c.env, c.projectId, userOf(c), id, plain(body)) })),
  }, {
    key: 'mark-entry-step-done', label: 'Mark done', kind: 'write', row_only: true,
    references: stepRef,
    execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await updateEntryStep(c.env, c.projectId, userOf(c), id, field(body, 'step'), { done: true }) })),
  }, {
    key: 'reopen-entry-step', label: 'Reopen', kind: 'write', row_only: true,
    references: stepRef,
    execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await updateEntryStep(c.env, c.projectId, userOf(c), id, field(body, 'step'), { done: false }) })),
  }, {
    key: 'edit-entry-step', label: 'Edit', kind: 'form', row_only: true,
    references: stepRef,
    form: { title: 'Edit entry step', cta: 'Save', fields: [
      { key: 'text', label: 'Step', kind: 'T', required: true },
      { key: 'owner_name', label: 'Owner', kind: 'T' },
      { key: 'due_on', label: 'Due', kind: 'T', input: 'date' },
    ] },
    execute: (c, _id, body) => refusing(async () => ({ ok: true,
      record: await updateEntryStep(c.env, c.projectId, userOf(c), id, field(body, 'step'), pick(body, ENTRY_STEP_EDIT)) })),
  }, {
    key: 'remove-entry-step', label: 'Remove', kind: 'write', tone: 'danger', row_only: true,
    confirm: { title: 'Remove this entry step?', body: 'It leaves the entry plan. Activity keeps a line that a step was removed.', cta: 'Remove' },
    references: stepRef,
    execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await removeEntryStep(c.env, c.projectId, userOf(c), id, field(body, 'step')) })),
  }, {
    // D8251: Accept writes through Edit market (a score) or Add entry step (a plan); Dismiss writes nothing.
    key: 'accept-proposal', label: 'Accept', kind: 'write', row_only: true,
    execute: (c, _id, body) => refusing(async () => { await decideMarketProposal(c.env, c.projectId, userOf(c), id, field(body, 'proposal'), 'accept'); return { ok: true, record: { uid: id } }; }),
  }, {
    key: 'dismiss-proposal', label: 'Dismiss', kind: 'write', row_only: true,
    execute: (c, _id, body) => refusing(async () => { await decideMarketProposal(c.env, c.projectId, userOf(c), id, field(body, 'proposal'), 'dismiss'); return { ok: true, record: { uid: id } }; }),
  }, {
    key: 'localisation-check', label: 'Tick a localisation check', kind: 'write', row_only: true,
    execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await setLocalisation(c.env, c.projectId, userOf(c), id, plain(body)) })),
  }, {
    key: 'edit', label: 'Edit', kind: 'form', tone: 'primary',
    form: { title: 'Edit market', cta: 'Save', foot: 'A score names where it came from.', fields: [
      { key: 'state', label: 'State', kind: 'CH', value: m.state, options: opts(MARKET_STATES, LABEL) },
      { key: 'decision', label: 'Decision', kind: 'CH', value: m.decision ?? '', options: marketDecisions },
      ...MARKET_PARTS.flatMap(([k, l]) => part(k, l)),
      { key: 'geography_ref', label: 'Attach a country', kind: 'CH', value: m.geography_ref ?? '',
        options: [{ value: '', label: 'Nothing yet' }, ...countries] },
      { key: 'size_cents', label: 'Size', kind: 'T', input: 'money', value: m.size_cents ?? '' },
      { key: 'size_currency', label: 'Currency', kind: 'T', value: m.size_currency ?? '' },
      { key: 'size_source', label: 'Size source', kind: 'T', value: m.size_source ?? '' },
    ] },
    execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await updateMarket(c.env, c.projectId, userOf(c), id, pick(body, MARKET_EDIT)) })),
  }, remove(`Remove ${m.name}?`, 'For a market added by mistake: it leaves the market list, its card and its counts, with its entry plan and localisation checks.',
    (c) => removeMarket(c.env, c.projectId, userOf(c), id))];
}, async (rc) => {
  return { states: opts(MARKET_STATES, LABEL), decisions: opts(DECISIONS, LABEL),
    geographies: await marketGeographies(rc) };
});

// ── Durable company-building — id: the obligation's id ──────────────────────

export const REMIND_PRESETS = [30, 14, 7, 1, 0] as const;
// D6790: the owner is picked from the company team (`owner_user_id`); `owner_name` stays for older callers.
const OBLIGATION_EDIT = ['title', 'kind', 'due_at', 'owner_user_id', 'owner_name', 'repeats', 'status'] as const;
/** D6790 (GR-23): the owner listbox — the company team, and "No one yet" to name nobody. */
const ownerChoices = (team: Array<{ value: string; label: string }>) => [{ value: '', label: 'No one yet' }, ...team];

const durable = spec('compliance_events', 'durable-company-building', GROW_OLD_ROWS['durable-company-building'], async (rc, id) => {
  const e = await rc.env.DB.prepare(
    'SELECT e.*, o.name AS owner_user_name FROM compliance_events e LEFT JOIN users o ON o.id = e.owner_user_id WHERE e.id = ? AND e.project_id = ?',
  ).bind(Number(id), rc.projectId).first<Any>();
  if (!e) throw vanished();
  const hasResolutions = e.event_type === 'board_meeting' || !!await rc.env.DB.prepare('SELECT 1 FROM board_resolutions WHERE event_id = ? LIMIT 1').bind(Number(id)).first();
  // D6790: the owner every surface shows, and whether the picked one is still on the company team.
  const owner = ownerShown(e.owner_user_name, e.owner_name);
  e.owner_on_team = e.owner_user_id != null && await onCompanyTeam(rc.env, rc.projectId, Number(e.owner_user_id)) ? 1 : 0;
  const kind = obligationKind(e);
  const state = obligationState(e.completion_status, kind, String(e.due_date), new Date().toISOString().slice(0, 10));
  const repeats = REPEATS_OF[String(e.recurrence)] ?? null;
  return keep({
    title: String(e.title),
    parts: { meeting: e.event_type === 'board_meeting' },
    sub: joined(label(kind), `due ${dMon(e.due_date) ?? e.due_date}`, owner),
    pills: [pill(state), ...(repeats ? [{ text: label(repeats), tone: 'grey' }] : [])],
    facts: [
      fact('Kind', label(kind), ''),
      fact('Due', e.due_date, ''),
      // D6790: an ownerless obligation offers Pick owner in place of the reason.
      { ...fact('Owner', owner, 'No owner named'), ...(owner ? {} : { action: 'pick-owner' }) },
      fact('Repeats', repeats ? label(repeats) : null, 'Repeat not recorded'),
    ],
    createdBy: e.created_by_user_id, createdAt: e.created_at,
  }, { e, kind, state, repeats, hasResolutions, owner });
}, [
  section('agenda', 'Agenda', async (rc, id) => {
    const res = await rc.env.DB.prepare('SELECT uid, text, owner_name FROM obligation_agenda_items WHERE event_id = ? ORDER BY id LIMIT 30').bind(Number(id)).all<Any>();
    // D6114 (#6114): each item names itself by uid, so Edit and Remove address it (a reader's rows lose their actions).
    return { rows: (res.results || []).map((a) => {
      const item = { item: String(a.uid) };
      return { a: String(a.text), b: a.owner_name ?? '', actions: [
        { key: 'edit-agenda', body: item, values: { text: String(a.text), owner_name: a.owner_name ?? '' } },
        { key: 'remove-agenda', body: item },
      ] };
    }), empty: 'No agenda item yet.', action: 'add-agenda' };
  }),
  section('past-meetings', 'Past meetings', async (rc, id) => {
    const res = await rc.env.DB.prepare(
      'SELECT id, held_on, minutes_file_key FROM obligation_occurrences WHERE event_id = ? ORDER BY held_on DESC, id DESC LIMIT 20',
    ).bind(Number(id)).all<{ id: number; held_on: string; minutes_file_key: string | null }>();
    return { rows: (res.results || []).map((o) => ({
      a: dMon(o.held_on) ?? o.held_on, b: o.minutes_file_key ? 'minutes stored' : 'no minutes', c: 'Held', tone: 'ok',
      ...(o.minutes_file_key ? { action: { key: 'open-minutes', body: { occurrence: o.id } } } : {}),
    })), empty: 'Not held yet.' };
  }),
  section('resolutions', 'Resolutions', async (rc, id) => {
    // D6788: LEFT JOIN keeps held meetings with none. No minutes object key leaves the Worker.
    const result = await rc.env.DB.prepare(`SELECT o.id AS occurrence_id, o.held_on, r.text, r.passed_on,
        r.minutes_file_key IS NOT NULL AS cites_minutes, u.name AS recorded_by
      FROM obligation_occurrences o LEFT JOIN board_resolutions r ON r.occurrence_uid = o.uid AND r.event_id = o.event_id
      LEFT JOIN users u ON u.id = r.recorded_by
      WHERE o.event_id = ? ORDER BY o.held_on DESC, o.id DESC, r.passed_on DESC, r.id DESC`)
      .bind(Number(id)).all<{ occurrence_id: number; held_on: string; text: string | null; passed_on: string | null; cites_minutes: number; recorded_by: string | null }>();
    return { rows: (result.results ?? []).map(r => r.text == null
      ? { a: `Meeting held ${r.held_on}`, b: 'None recorded' }
      : { a: r.text, b: `Held ${r.held_on} · Passed ${r.passed_on} · Recorded by ${r.recorded_by ?? 'Not recorded'}`, c: r.cites_minutes ? 'Minutes cited' : '',
        ...(r.cites_minutes ? { action: { key: 'open-minutes', body: { occurrence: r.occurrence_id } } } : {}) }), empty: 'None recorded' };
  }, { when: (_id, record) => loadedOf(record).hasResolutions, note: 'By held meeting, newest first.' }),
  section('reminders', 'Reminders', async (_rc, _id, record) => {
    const { e } = loadedOf(record);
    const sent = dayList(e.reminders_sent_json);
    const days = dayList(e.remind_days_json).sort((a, b) => b - a);
    // D6790: the step names who it reminds, as the daily run decides it (`reminderAssignee`).
    const assignee = reminderAssignee(e);
    const to = assignee.to === 'owner' ? ownerShown(e.owner_user_name, null) ?? 'Unnamed member' : 'The founder';
    return { rows: [...days.map((n) => ({ a: reminderLabel(n), c: sent.includes(n) ? 'Sent' : 'On', tone: sent.includes(n) ? 'grey' : 'ok' })),
      ...(days.length ? [{ a: 'Goes to', b: to }] : [])],
      empty: 'No reminder set.' };
  }, { side: true }),
  section('documents', 'Documents', async (rc, id) => {
    const minutes = await rc.env.DB.prepare('SELECT COUNT(*) AS n FROM obligation_occurrences WHERE event_id = ? AND minutes_file_key IS NOT NULL')
      .bind(Number(id)).first<{ n: number }>();
    return { rows: [{ a: 'Minutes', b: `${Number(minutes?.n ?? 0)} stored` }] };
  }, { side: true }),
], async (rc, id, record): Promise<RecordAction[]> => {
  const { e, kind, repeats, owner } = loadedOf(record);
  const members = await companyTeam(rc.env, rc.projectId);
  const team = ownerChoices(members);
  // D6790: a name typed before #6790 stays until someone on the team is picked.
  const typedNote = e.owner_user_id == null && ownerShown(null, e.owner_name)
    ? `Typed before owners were picked from the team: ${ownerShown(null, e.owner_name)}. It stays until you pick someone.` : undefined;
  const hasMinutes = await rc.env.DB.prepare('SELECT 1 FROM obligation_occurrences WHERE event_id = ? AND minutes_file_key IS NOT NULL LIMIT 1').bind(Number(id)).first();
  const actions: RecordAction[] = [{
    key: 'mark-held', label: 'Mark held', kind: 'form', tone: 'primary',
    form: { title: 'Mark held', cta: 'Mark held',
      foot: e.recurrence === 'one_time' ? 'A one-time obligation is then done.' : `Moves the due date on by its repeat (${label(repeats ?? 'once').toLowerCase()}).`,
      fields: [
        { key: 'held_on', label: 'Held on', kind: 'T', input: 'date', required: true },
        { key: 'notes', label: 'Notes', kind: 'T' },
        { key: 'minutes', label: 'Minutes', kind: 'T', input: 'file', note: 'PDF or DOCX, up to 20 MB.' },
        ...(e.event_type === 'board_meeting' ? [
          { key: 'resolutions', label: 'Resolutions', kind: 'T' as const, input: 'textarea' as const, max: 40019, note: 'One resolution per line, up to 20. Each can have up to 2000 characters. Leave blank when none were passed.' },
          { key: 'resolutions_passed_on', label: 'Resolutions passed on', kind: 'T' as const, input: 'date' as const, note: 'Defaults to Held on when left blank.' },
          { key: 'cite_minutes', label: 'Cite uploaded minutes for these resolutions', kind: 'CH' as const, value: 'no', options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }] },
        ] : []),
      ] },
    execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await markHeld(c.env, c.projectId, userOf(c), Number(id), {
      held_on: field(body, 'held_on'), notes: field(body, 'notes'), minutes: field(body, 'minutes'),
      resolutions: field(body, 'resolutions'), resolutions_passed_on: field(body, 'resolutions_passed_on'), cite_minutes: field(body, 'cite_minutes'),
    }) })),
  }, {
    key: 'add-agenda', label: 'Add agenda item', kind: 'form',
    form: { title: 'Add agenda item', cta: 'Add', fields: [
      { key: 'text', label: 'Item', kind: 'T', required: true },
      { key: 'owner_name', label: 'Owner', kind: 'T' },
    ] },
    execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await addAgendaItem(c.env, c.projectId, userOf(c), Number(id), plain(body)) })),
  }, {
    key: 'edit-agenda', label: 'Edit', kind: 'form', row_only: true,
    references: agendaRef,
    form: { title: 'Edit agenda item', cta: 'Save', fields: [
      { key: 'text', label: 'Item', kind: 'T', required: true },
      { key: 'owner_name', label: 'Owner', kind: 'T' },
    ] },
    execute: (c, _id, body) => refusing(async () => ({ ok: true,
      record: await updateAgendaItem(c.env, c.projectId, userOf(c), Number(id), field(body, 'item'), pick(body, AGENDA_EDIT)) })),
  }, {
    key: 'remove-agenda', label: 'Remove', kind: 'write', tone: 'danger', row_only: true,
    confirm: { title: 'Remove this agenda item?', body: 'It leaves the agenda. Activity keeps a line that an item was removed.', cta: 'Remove' },
    references: agendaRef,
    execute: (c, _id, body) => refusing(async () => ({ ok: true, record: await removeAgendaItem(c.env, c.projectId, userOf(c), Number(id), field(body, 'item')) })),
  }];
  if (hasMinutes) {
    actions.push({
      key: 'open-minutes', label: 'Open minutes', kind: 'write', row_only: true,
      // The occurrence is checked in its own store, then against this obligation by the writer.
      references: (body) => [{ store: 'obligation_occurrences', id: refOf(field(body, 'occurrence')) }],
      execute: (c, _id, body) => refusing(async () => ({ ok: true, ...(await openMinutes(c.env, c.projectId, userOf(c), Number(id), Number(field(body, 'occurrence')))) })),
    });
  }
  actions.push({
    key: 'edit', label: 'Edit', kind: 'form', tone: 'primary',
    form: { title: 'Edit obligation', cta: 'Save', fields: [
      { key: 'title', label: 'Obligation', kind: 'T', value: e.title, required: true },
      { key: 'kind', label: 'Kind', kind: 'CH', value: kind, options: opts(OBLIGATION_KINDS, LABEL) },
      { key: 'due_at', label: 'Due', kind: 'T', input: 'date', value: e.due_date, required: true },
      { key: 'owner_user_id', label: 'Owner', kind: 'CH', value: e.owner_user_id == null ? '' : String(e.owner_user_id), options: team,
        ...(typedNote ? { note: typedNote } : {}) },
      { key: 'repeats', label: 'Repeats', kind: 'CH', value: repeats ?? 'once', options: opts(Object.keys(REPEATS), LABEL) },
      { key: 'remind_days', label: 'Remind', kind: 'CK', value: dayList(e.remind_days_json).map(String),
        options: REMIND_PRESETS.map((n) => ({ value: String(n), label: reminderLabel(n) })), note: 'At most three.' },
      // Draft and Not set up are not states an obligation can be in (decision 10).
      { key: 'status', label: 'State', kind: 'CH', value: obligationState(e.completion_status, kind, String(e.due_date), new Date().toISOString().slice(0, 10)),
        options: opts(OBLIGATION_STATES.filter((s) => s !== 'draft' && s !== 'not_set_up'), LABEL) },
    ] },
    execute: (c, _id, body) => refusing(async () => {
      const b = pick(body, OBLIGATION_EDIT);
      const remind = field(body, 'remind_days');
      if (remind !== undefined) b.remind_days = (Array.isArray(remind) ? remind : remind == null || remind === '' ? [] : [remind]).map(Number);
      return { ok: true, record: await updateObligation(c.env, c.projectId, userOf(c), Number(id), b) };
    }),
  });
  if (!owner) {
    // D6790 (GR-23): Pick owner, drawn from the Owner fact of an ownerless obligation, opens the same listbox.
    actions.push({
      key: 'pick-owner', label: 'Pick owner', kind: 'form', row_only: true,
      form: { title: 'Pick owner', cta: 'Save',
        sub: members.length ? 'Someone on the company team. Its reminders then go to them.'
          : 'No one is on the company team yet, so there is no one to pick. Add people to the company first.',
        fields: [{ key: 'owner_user_id', label: 'Owner', kind: 'CH', value: '', options: members, required: true }] },
      execute: (c, _id, body) => refusing(async () => ({ ok: true,
        record: await updateObligation(c.env, c.projectId, userOf(c), Number(id), { owner_user_id: field(body, 'owner_user_id') ?? null }) })),
    });
  }
  actions.push(remove(`Remove ${e.title}?`, 'For an obligation added by mistake: it leaves the list, its card and its counts, with its agenda. One that has been held stays; mark it done instead.',
    (c) => removeObligation(c.env, c.projectId, userOf(c), Number(id))));
  return actions;
}, async (rc) => ({
  kinds: opts(OBLIGATION_KINDS, LABEL),
  // D6790: the Add and Edit owner listbox, the company team.
  owners: await companyTeam(rc.env, rc.projectId),
  repeats: opts(Object.keys(REPEATS), LABEL),
  remind_presets: REMIND_PRESETS.map((n) => ({ value: String(n), label: reminderLabel(n) })),
}));

const refOf = (raw: unknown): string | number => (typeof raw === 'number' || typeof raw === 'string' ? raw : '');

/** Grow's module specs, by slug, as `services/records/index.ts` registers them. */
export const GROW_RECORDS: Record<string, ModuleSpec> = {
  'product-improvement': productImprovement,
  distribution,
  'revenue-and-traction': revenue,
  'team-expansion': teamExpansion,
  'partner-network': partnerNetwork,
  'market-expansion': marketExpansion,
  'durable-company-building': durable,
};
