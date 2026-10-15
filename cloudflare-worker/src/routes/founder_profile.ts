/**
 * D702 — the founder's profile pages, mounted at /api/profile beside
 * `profile_history.ts` (whose paths are /evidence-blend, /history, /reask,
 * /archetype-published and /published-members; none of these collide).
 *
 *   GET   /me                         the caller's own You page: person, bio,
 *                                     background, links, co-founder preferences
 *   GET   /venture?project=N          Your venture: card, problem, facts and
 *                                     the rows read from the venture's modules
 *   PATCH /venture?project=N          writes the seven editable facts
 *   GET   /preview?project=N&audience=investors|founders|partners
 *                                     What others see: the reads that audience
 *                                     makes, run as a member of that role who
 *                                     matches no row (id 0, no NDA, no
 *                                     introduction, no membership)
 *
 * GATES. `/me` is the caller and nobody else; it takes no id. The venture
 * routes and the preview need `canWrite` on the named venture (its founder or
 * an admin); everyone else gets 403, and a missing or deleted venture 404. A
 * founder's venture outside their active company answers 404 too, as every
 * company-scoped venture read does.
 *
 * NOTHING HERE MASKS. The preview calls `publicPersonCard`, `publicStartupCard`,
 * `projectReadFor` and `publishedMembersFor`, the functions the routes those
 * audiences hit already call, and reports what they returned. It never decides
 * on its own what an audience may see.
 *
 * NEVER A KYC FIELD. The person line's city is the co-founder profile's
 * `location_city`; `users.city` is the KYC address and is not read here.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { canWrite } from './_founder_validate_helpers';
import { activeCompanyFor } from '../middleware/activeCompany';
import { projectInActiveCompany } from '../services/tenancyScope';
import { ensureProfileExpansionSchema } from '../services/profileExpansion';
import { publicPersonCard, publicStartupCard, STARTUP_NOT_PUBLIC_STATUSES, type CardResult } from './public';
import { projectReadFor } from './projects';
import { publishedMembersFor } from './profile_history';
import { buildLifecycleResponse } from './progress';
import { indexCountsOf } from '../services/validateFocus';
import { figures as validateFigures } from '../services/cycleValidate';
import { growFigures } from '../services/growCycle';
import { WAITLIST_TARGET_KEY } from '../services/validateWriters';
import { effectiveVisibilityFor, type EffectiveVisibility } from '../services/userSettings';
import type { Figure } from '../services/cycleCards';

const r = new Hono<{ Bindings: Env }>();

const safeJson = <T>(raw: unknown, fallback: T): T => {
  if (raw == null || raw === '') return fallback;
  try { const v = JSON.parse(String(raw)); return (v ?? fallback) as T; } catch { return fallback; }
};
const str = (v: unknown): string | null => {
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t : null;
};

// ---------------------------------------------------------------------------
// GET /me — the You page
// ---------------------------------------------------------------------------

const COMMITMENT_LABEL: Record<string, string> = {
  full_time: 'Full-time', part_time: 'Part-time', exploring: 'Exploring',
};

/** "<title> at <company>" with "<start> – <end>"; absent parts are left out, never invented. */
export function experienceRow(e: Record<string, unknown>) {
  const title = str(e.title);
  const company = str(e.company) ?? str(e.org);
  const line = title && company ? `${title} at ${company}` : (title ?? company);
  const period = [str(e.start), str(e.end)].filter(Boolean).join(' – ') || null;
  return line ? { line, period } : null;
}

/** "<degree>, <school>" with the end year. */
export function educationRow(e: Record<string, unknown>) {
  const degree = str(e.degree);
  const school = str(e.school);
  const line = degree && school ? `${degree}, ${school}` : (degree ?? school);
  const end = str(e.end);
  const year = end ? (end.match(/\d{4}/)?.[0] ?? end) : null;
  return line ? { line, year } : null;
}

r.get('/me', async (c) => {
  const user = await requireAuth(c);
  try {
    await ensureProfileExpansionSchema(c.env);
    const u = await c.env.DB.prepare(
      'SELECT id, name, display_name, bio, socials FROM users WHERE id = ?',
    ).bind(user.id).first<{ id: number; name: string | null; display_name: string | null; bio: string | null; socials: string | null }>();
    const ext = await c.env.DB.prepare(
      'SELECT experience, education, website FROM user_profile_ext WHERE user_id = ?',
    ).bind(user.id).first<{ experience: string | null; education: string | null; website: string | null }>().catch(() => null);
    const cf = await c.env.DB.prepare(
      'SELECT looking_for, commitment, location_city, remote_ok FROM cofounder_profiles WHERE user_id = ?',
    ).bind(user.id).first<{ looking_for: string | null; commitment: string | null; location_city: string | null; remote_ok: number | null }>().catch(() => null);

    const socials = safeJson<Record<string, unknown>>(u?.socials, {});
    const city = str(cf?.location_city);
    const website = str(ext?.website) ?? str(socials.website);
    const experience = safeJson<Array<Record<string, unknown>>>(ext?.experience, [])
      .map(experienceRow).filter(Boolean);
    const education = safeJson<Array<Record<string, unknown>>>(ext?.education, [])
      .map(educationRow).filter(Boolean);
    const link = (key: string, label: string, url: string | null) => ({ key, label, url });

    return c.json({
      person: {
        name: str(u?.display_name) ?? str(u?.name),
        // The co-founder profile's city, never `users.city` (the KYC address).
        role_line: city ? `Founder · ${city}` : 'Founder',
      },
      bio: str(u?.bio),
      background: { experience, education },
      links: [
        link('linkedin', 'LinkedIn', str(socials.linkedin)),
        link('website', 'Website', website),
        link('github', 'GitHub', str(socials.github)),
      ],
      preferences: cf
        ? {
            recorded: true,
            looking_for: str(cf.looking_for),
            commitment: str(cf.commitment),
            commitment_label: cf.commitment ? (COMMITMENT_LABEL[cf.commitment] ?? null) : null,
            location: city ? (Number(cf.remote_ok) === 1 ? `${city} · remote` : city) : null,
          }
        : { recorded: false, reason: 'No co-founder profile yet' },
    });
  } catch (e) {
    return refuse(c, 503, { code: 'profile_unreadable', message: 'Your profile could not be read. Try again in a moment.', raw: e });
  }
});

// ---------------------------------------------------------------------------
// The venture gate (decision 11)
// ---------------------------------------------------------------------------

type VentureRow = {
  id: number; uid: string | null; name: string | null; founder_id: number | null; company_id?: number | null; status: string | null;
  description: string | null; sector: string | null; problem_statement: string | null;
  founded_year: number | null; hq: string | null; employee_count: string | null; website: string | null;
};

async function ventureFor(
  c: Context<{ Bindings: Env }>, user: User,
): Promise<{ venture: VentureRow } | { refusal: Response }> {
  const raw = c.req.query('project');
  const id = Number(raw);
  if (raw == null || raw === '' || !Number.isInteger(id) || id <= 0) {
    return { refusal: refuse(c, 400, { code: 'invalid_project', message: 'project is your venture’s id.' }) };
  }
  const row = await c.env.DB.prepare(
    `SELECT id, uid, name, founder_id, company_id, status, description, sector, problem_statement,
            founded_year, hq, employee_count, website
       FROM projects WHERE id = ? AND deleted_at IS NULL`,
  ).bind(id).first<VentureRow>();
  if (!row) return { refusal: refuse(c, 404, { code: 'project_not_found', message: 'Project not found' }) };
  if (!canWrite({ id: row.id, founder_id: row.founder_id }, user)) {
    return { refusal: refuse(c, 403, { code: 'not_your_venture', message: 'Only the venture’s founder can see this page.' }) };
  }
  // The founder's own venture outside the company they have selected is not
  // in this workspace, so it answers as missing, as progress.ts `loadProject`
  // does. Admins are exempt: `company_id` is the founder's company, never theirs.
  if (String(user.role || '').toLowerCase() !== 'admin'
      && !projectInActiveCompany(await activeCompanyFor(c, user), row)) {
    return { refusal: refuse(c, 404, { code: 'project_not_found', message: 'Project not found' }) };
  }
  return { venture: row };
}

// ---------------------------------------------------------------------------
// GET /venture — Your venture
// ---------------------------------------------------------------------------

type ModuleRow = { key: string; label: string; sub: string; value: string | null; state: string; reason: string | null };

const figureOf = (list: Figure[], key: string) => list.find((f) => f.key === key) ?? null;

/** The four "Read from your modules" rows, each from its module's own export, never re-counted. */
async function moduleRows(env: Env, projectId: number): Promise<ModuleRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const settle = async <T>(f: () => Promise<T>): Promise<T | null> => {
    try { return await f(); } catch (e) { console.error('[founder_profile] module read failed', (e as Error).message); return null; }
  };
  const [counts, vfigs, gfigs, bar] = await Promise.all([
    settle(() => indexCountsOf(env, projectId)),
    settle(() => validateFigures({ env, projectId, today })),
    settle(() => growFigures({ env, projectId, now: Date.now(), href: (slug) => `/grow/${slug}?project=${projectId}` })),
    settle(() => env.DB.prepare('SELECT target_value FROM metric_targets WHERE project_id = ? AND metric_key = ?')
      .bind(projectId, WAITLIST_TARGET_KEY).first<{ target_value: number | null }>()),
  ]);
  const unreadable = (key: string, label: string, sub: string): ModuleRow =>
    ({ key, label, sub, value: null, state: 'unreadable', reason: `${label} could not be read` });

  const interviews: ModuleRow = counts == null
    ? unreadable('interviews', 'Interviews', 'Validate · Customer research')
    : counts.interviews_total > 0
      ? { key: 'interviews', label: 'Interviews', sub: 'Validate · Customer research', value: String(counts.interviews_total), state: 'ok', reason: null }
      : { key: 'interviews', label: 'Interviews', sub: 'Validate · Customer research', value: null, state: 'empty', reason: 'No interview logged yet' };

  const hyp = vfigs ? figureOf(vfigs, 'hypotheses_supported') : null;
  const hypotheses: ModuleRow = !hyp || hyp.state === 'unreadable'
    ? unreadable('hypotheses_supported', 'Hypotheses supported', 'Validate · Experiments and evidence')
    : hyp.value == null
      ? { key: 'hypotheses_supported', label: 'Hypotheses supported', sub: 'Validate · Experiments and evidence', value: null, state: hyp.state, reason: hyp.reason ?? 'No hypothesis written yet' }
      : { key: 'hypotheses_supported', label: 'Hypotheses supported', sub: 'Validate · Experiments and evidence', value: `${hyp.value} ${hyp.unit}`, state: 'ok', reason: null };

  const wl = vfigs ? figureOf(vfigs, 'waitlist_signups') : null;
  const target = bar && bar.target_value != null && Number(bar.target_value) > 0 ? Number(bar.target_value) : null;
  const waitlist: ModuleRow = !wl || wl.state === 'unreadable'
    ? unreadable('waitlist_signups', 'Waitlist sign-ups', 'Validate · Demand and urgency signals')
    : wl.value == null
      ? { key: 'waitlist_signups', label: 'Waitlist sign-ups', sub: 'Validate · Demand and urgency signals', value: null, state: wl.state, reason: wl.reason ?? 'No waitlist sign-up yet' }
      : { key: 'waitlist_signups', label: 'Waitlist sign-ups', sub: 'Validate · Demand and urgency signals', value: target ? `${wl.value} of ${target}` : String(wl.value), state: 'ok', reason: null };

  const m = gfigs ? figureOf(gfigs, 'mrr') : null;
  const mrr: ModuleRow = !m || m.state === 'unreadable'
    ? unreadable('mrr', 'MRR', 'Grow · Revenue and traction')
    : m.value == null
      // The canvas's "no revenue source connected" would be false: MRR can be
      // entered by hand. This says what is true.
      ? { key: 'mrr', label: 'MRR', sub: 'Grow · no MRR recorded yet', value: null, state: m.state, reason: 'Not recorded' }
      : { key: 'mrr', label: 'MRR', sub: 'Grow · Revenue and traction', value: String(m.value), state: 'ok', reason: null };

  return [interviews, hypotheses, waitlist, mrr];
}

async function ventureView(env: Env, v: VentureRow) {
  let stage: { id: string | null; label: string | null } = { id: null, label: null };
  try {
    const lc = await buildLifecycleResponse(env, v.id);
    const meta = (lc.stages as Array<{ id: string; label: string }>).find((s) => s.id === lc.stage);
    stage = { id: lc.stage ?? null, label: meta?.label ?? null };
  } catch (e) {
    console.error('[founder_profile] lifecycle unreadable', (e as Error).message);
  }
  return {
    project_id: v.id,
    card: { name: v.name, description: v.description, sector: v.sector, stage },
    problem_statement: v.problem_statement,
    facts: {
      founded_year: v.founded_year ?? null,
      hq: v.hq,
      employee_count: v.employee_count,
      website: v.website,
    },
    modules: await moduleRows(env, v.id),
  };
}

r.get('/venture', async (c) => {
  const user = await requireAuth(c);
  const g = await ventureFor(c, user);
  if ('refusal' in g) return g.refusal;
  try {
    return c.json(await ventureView(c.env, g.venture));
  } catch (e) {
    return refuse(c, 503, { code: 'venture_unreadable', message: 'Your venture could not be read. Try again in a moment.', raw: e });
  }
});

// ---------------------------------------------------------------------------
// PATCH /venture — the seven editable facts
// ---------------------------------------------------------------------------

const MAX_LEN: Record<string, number> = {
  description: 280, sector: 80, problem_statement: 1000, hq: 120, employee_count: 40, website: 300,
};
export const VENTURE_FIELDS = ['description', 'sector', 'problem_statement', 'founded_year', 'hq', 'employee_count', 'website'] as const;

/** Validates a PATCH body. Returns the column values to write, or the refusal sentence and field. */
export function ventureUpdate(body: Record<string, unknown>, thisYear = new Date().getUTCFullYear()):
  { ok: true; values: Record<string, string | number | null> } | { ok: false; field: string; message: string } {
  const values: Record<string, string | number | null> = {};
  for (const key of Object.keys(body)) {
    if (!(VENTURE_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, field: key, message: `${key} cannot be changed here.` };
    }
  }
  for (const key of VENTURE_FIELDS) {
    if (!(key in body)) continue;
    const raw = body[key];
    if (raw === null || raw === '') { values[key] = null; continue; }
    if (key === 'founded_year') {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1900 || n > thisYear) {
        return { ok: false, field: key, message: `Founded is a year from 1900 to ${thisYear}.` };
      }
      values[key] = n;
      continue;
    }
    if (typeof raw !== 'string') return { ok: false, field: key, message: `${key} is text.` };
    const t = raw.trim();
    if (t.length > MAX_LEN[key]) return { ok: false, field: key, message: `${key} is at most ${MAX_LEN[key]} characters.` };
    if (key === 'website') {
      let u: URL | null = null;
      try { u = new URL(t); } catch { u = null; }
      if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) {
        return { ok: false, field: key, message: 'Website is an http or https address.' };
      }
    }
    values[key] = t || null;
  }
  return { ok: true, values };
}

r.patch('/venture', async (c) => {
  const user = await requireAuth(c);
  const g = await ventureFor(c, user);
  if ('refusal' in g) return g.refusal;
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return refuse(c, 400, { code: 'invalid_body', message: 'Send the facts to change as an object.' });
  }
  const v = ventureUpdate(body);
  if (!v.ok) return c.json({ error: v.message, field: v.field }, 400);
  const cols = Object.keys(v.values);
  if (cols.length === 0) return refuse(c, 400, { code: 'nothing_to_change', message: 'Name at least one fact to change.' });
  const before = g.venture;
  try {
    // One statement per column, each literal, so no column name is assembled
    // into query text (check-sql-prepare).
    const UPDATE: Record<string, string> = {
      description: 'UPDATE projects SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      sector: 'UPDATE projects SET sector = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      problem_statement: 'UPDATE projects SET problem_statement = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      founded_year: 'UPDATE projects SET founded_year = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      hq: 'UPDATE projects SET hq = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      employee_count: 'UPDATE projects SET employee_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      website: 'UPDATE projects SET website = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    };
    await c.env.DB.batch(cols.map((col) => c.env.DB.prepare(UPDATE[col]).bind(v.values[col], before.id)));
  } catch (e) {
    return refuse(c, 503, { code: 'venture_not_saved', message: 'Your venture was not saved. Try again in a moment.', raw: e });
  }
  // Search reads the description, sector and problem, so re-embed when one moved.
  const searchable = ['description', 'sector', 'problem_statement'] as const;
  if (searchable.some((k) => k in v.values && (v.values[k] ?? null) !== (before[k] ?? null))) {
    try { const { Jobs } = await import('../models/jobs'); await Jobs.enqueue(c.env, 'embed_entity', { type: 'project', id: before.id }); } catch {}
  }
  const after = await c.env.DB.prepare(
    `SELECT id, uid, name, founder_id, status, description, sector, problem_statement,
            founded_year, hq, employee_count, website
       FROM projects WHERE id = ?`,
  ).bind(before.id).first<VentureRow>();
  return c.json(await ventureView(c.env, after ?? before));
});

// ---------------------------------------------------------------------------
// GET /preview — What others see
// ---------------------------------------------------------------------------

export const AUDIENCES = { investors: 'investor', founders: 'founder', partners: 'partner' } as const;
export type Audience = keyof typeof AUDIENCES;

type Read = { status: number; body: Record<string, unknown> };
type FigureRow = { key: string; label: string; display: 'value' | 'masked'; value: unknown };

/** decision 3's figures table: which read serves which field, and under what name. */
const FIGURE_SOURCES: Array<{ key: string; label: string; startup: string | null; app: string }> = [
  { key: 'mrr', label: 'MRR', startup: null, app: 'mrr' },
  { key: 'revenue', label: 'Revenue', startup: 'revenue', app: 'revenue' },
  { key: 'users', label: 'Users', startup: 'users', app: 'users_count' },
  { key: 'raise', label: 'Raise', startup: 'funding_needed', app: 'funding_needed' },
];

/**
 * A row shows its value when any read of the audience serves it unmasked, "••••"
 * when the only read that serves it masks it, and is left out when none serves
 * it. A read that answers 404 or 403 serves nothing.
 */
export function figureRows(startup: Read, app: Read): FigureRow[] {
  const traction = startup.status === 200 ? ((startup.body.traction as Record<string, unknown>) ?? {}) : null;
  const appOk = app.status === 200;
  const appMasked = appOk && app.body.__masked === true;
  const rows: FigureRow[] = [];
  for (const f of FIGURE_SOURCES) {
    if (traction && f.startup && f.startup in traction) {
      rows.push({ key: f.key, label: f.label, display: 'value', value: traction[f.startup] ?? null });
      continue;
    }
    if (appOk && !appMasked && f.app in app.body) {
      rows.push({ key: f.key, label: f.label, display: 'value', value: app.body[f.app] ?? null });
      continue;
    }
    if (appMasked && f.app in app.body) rows.push({ key: f.key, label: f.label, display: 'masked', value: null });
  }
  return rows;
}

const PUBLIC_FIELD_WORDS: Array<{ key: string; word: string }> = [
  { key: 'revenue', word: 'revenue' }, { key: 'users', word: 'users' }, { key: 'funding_needed', word: 'the raise' },
];
const listOf = (words: string[]) => (words.length <= 1 ? words.join('')
  : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);

/** decision 3's note: one sentence per fact that happened, composed here, never by the page. */
export function previewNotes(audience: Audience, startup: Read, app: Read, ventureStatus: string | null): string[] {
  const notes: string[] = [];
  if (startup.status === 200) {
    const traction = (startup.body.traction as Record<string, unknown>) ?? {};
    const served = PUBLIC_FIELD_WORDS.filter((w) => traction[w.key] != null).map((w) => w.word);
    if (served.length) {
      const s = listOf(served);
      notes.push(`${s.charAt(0).toUpperCase()}${s.slice(1)} ${served.length === 1 && served[0] !== 'users' ? 'is' : 'are'} on your public venture page, for anyone with its address.`);
    }
  } else {
    notes.push(`Your venture page is not public while the venture is in ${ventureStatus || 'its current status'}.`);
  }
  if (audience === 'investors') {
    if (app.status === 404) notes.push('Investors without an introduction cannot find your venture in the app.');
    else if (app.status === 200 && app.body.__masked === true) notes.push('In the app, figures stay masked until an NDA is signed through an introduction.');
  } else if (audience === 'founders') {
    notes.push('Other founders cannot open your venture in the app.');
  } else {
    notes.push('Partners can open your venture in the app and read every figure.');
  }
  return notes;
}

const SERVED_TO: Record<EffectiveVisibility, { served_to: string; reason: string }> = {
  public: { served_to: 'everyone', reason: 'Your profile is public.' },
  network: { served_to: 'members', reason: 'Your profile is for signed-in members only.' },
  private: { served_to: 'only_you', reason: 'Your profile is hidden.' },
};

r.get('/preview', async (c) => {
  const user = await requireAuth(c);
  const aud = (c.req.query('audience') || 'investors') as Audience;
  if (!(aud in AUDIENCES)) {
    return refuse(c, 400, { code: 'invalid_audience', message: 'audience is investors, founders or partners.' });
  }
  const g = await ventureFor(c, user);
  if ('refusal' in g) return g.refusal;
  const v = g.venture;
  try {
    // The person is the venture's founder user, not the caller: the lowest
    // users.id carrying the venture's founder_id, as the public read resolves it.
    const founder = v.founder_id == null ? null : await c.env.DB.prepare(
      'SELECT id, uid FROM users WHERE founder_id = ? ORDER BY id LIMIT 1',
    ).bind(v.founder_id).first<{ id: number; uid: string | null }>();

    // A member of the audience's role who matches no row.
    const role = AUDIENCES[aud];
    const viewer = { id: 0, role };
    const viewerUser = { id: 0, role, founder_id: null, investor_id: null, partner_id: null, spinout_lab_active: 0 } as unknown as User;

    const nf: CardResult = { status: 404, body: { detail: 'Not found' } };
    const person = founder?.uid ? await publicPersonCard(c.env, String(founder.uid).toLowerCase(), viewer) : nf;
    const startup = v.uid ? await publicStartupCard(c.env, String(v.uid).toLowerCase(), viewer) : nf;
    const app = await projectReadFor(c.env, viewerUser, v.id);

    // The archetype chip: drawn when the published-members read, asked as this
    // member for the founder's displayed archetype, lists the founder.
    let archetype: { slug: string; label: string | null } | null = null;
    if (founder) {
      const snap = await c.env.DB.prepare(
        `SELECT displayed_slug FROM profile_snapshots WHERE user_id = ? AND persona = 'founder' ORDER BY id DESC LIMIT 1`,
      ).bind(founder.id).first<{ displayed_slug: string | null }>().catch(() => null);
      if (snap?.displayed_slug) {
        const listed = await publishedMembersFor(c.env, viewer, [snap.displayed_slug]).catch(() => null);
        const me = listed?.items.find((m) => Number(m.user_id) === Number(founder.id));
        if (me) archetype = { slug: me.slug, label: me.label };
      }
    }

    const status = String(v.status || '').toLowerCase();
    const vis = founder ? ((await effectiveVisibilityFor(c.env, [founder.id])).get(founder.id) ?? 'public') : null;
    const profileAddress = founder?.uid
      ? { url: `https://axal.vc/u/${founder.uid}`, ...SERVED_TO[vis ?? 'public'] }
      : { url: null, served_to: 'no_one', reason: 'No member account is linked to this venture.' };
    const ventureAddress = !v.uid
      ? { url: null, served_to: 'no_one', reason: 'This venture has no public address.' }
      : STARTUP_NOT_PUBLIC_STATUSES.includes(status)
        ? { url: `https://axal.vc/startups/${v.uid}`, served_to: 'no_one', reason: `Your venture page is not public while the venture is in ${status}.` }
        : { url: `https://axal.vc/startups/${v.uid}`, served_to: 'everyone', reason: 'Your venture page is public.' };

    const sb = startup.status === 200 ? startup.body : null;
    const ab = app.status === 200 ? app.body : null;
    return c.json({
      audience: aud,
      card: {
        person_name: person.status === 200 ? ((person.body.name as string | null) ?? null) : null,
        venture_name: (sb?.name as string | undefined) ?? (ab?.name as string | undefined) ?? null,
        sector: (sb?.sector as string | undefined) ?? (ab?.sector as string | undefined) ?? null,
        archetype,
      },
      figures: figureRows(startup, app),
      notes: previewNotes(aud, startup, app, status),
      addresses: { profile: profileAddress, venture: ventureAddress },
      reads: {
        person: { status: person.status },
        startup: { status: startup.status },
        app: { status: app.status, masked: ab ? ab.__masked === true : null },
      },
    });
  } catch (e) {
    return refuse(c, 503, { code: 'preview_unreadable', message: 'What others see could not be worked out. Try again in a moment.', raw: e });
  }
});

export default r;
