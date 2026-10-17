/**
 * D690 (S18-B, #1694) — Build's six one-record reads, as CO:369-374 draws them.
 *
 * Each read is fixed, bound SQL scoped to the venture the route has already
 * proven owns the id (`ownedRow`). It writes nothing. A fact with no store is
 * `{ value: null, reason }`, and a section with no store reads Not recorded
 * with its reason. Only links are declared as actions here; #1695 adds the
 * writes. Decision numbers are #1693's and #1694's.
 */
import type { Env } from '../../types';
import { CONNECTOR_METADATA, getDescriptor } from '../../integrations/registry';
import { canWrite } from '../../routes/_founder_validate_helpers';
import type { ModuleSpec, RecordAction, RecordContent, RecordContext, RecordFact, Row } from './types';

type Any = Record<string, any>;
type Section = { rows: Row[]; empty?: string };

const LEVEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const IMPACT_KEY: Record<string, string> = { High: 'high', Medium: 'medium', Low: 'low' };
const EFFORT_KEY: Record<string, string> = { S: 'low', M: 'medium', L: 'high', XL: 'high' };
const MUST_KEY: Record<string, string> = { Backlog: 'not_started', 'In Progress': 'in_progress', Review: 'in_progress', Done: 'done', Blocked: 'blocked' };
const MUST_LABEL: Record<string, string> = { blocked: 'Blocked', in_progress: 'In progress', not_started: 'Not started', done: 'Done' };
const MUST_TONE: Record<string, string> = { blocked: 'bad', in_progress: 'vio', not_started: 'grey', done: 'ok' };
const COLUMN_LABEL: Record<string, string> = { now: 'Now', next: 'Next', later: 'Later', done: 'Done' };
const SEVERITY_TONE: Record<string, string> = { high: 'bad', medium: 'amb', low: 'grey' };
const FEEDS_LABEL: Record<string, string> = { use_of_funds: 'Use of funds', kpis: 'KPIs', team: 'Team' };
const SYNC_LABEL: Record<string, string> = { live: 'Live', hourly: 'Hourly', daily: 'Daily', manual: 'Manual' };
const FILING_KIND: Record<string, string> = {
  formation: 'Formation', ein: 'EIN', '83b': '83(b) election', annual_report: 'Annual report', franchise_tax: 'Franchise tax', other: 'Other',
};
const FILING_TONE: Record<string, string> = { filed: 'ok', due_soon: 'amb', overdue: 'bad', upcoming: 'grey' };
const LAB_STEPS = ['Order paid', 'Formation packet ready', 'Filed with state'] as const;
export const SYSTEM_KINDS = ['bank', 'accounting', 'payroll', 'crm', 'workspace'] as const;
type SystemKind = typeof SYSTEM_KINDS[number];
const SYSTEM_LABEL: Record<SystemKind, string> = { bank: 'Bank', accounting: 'Accounting', payroll: 'Payroll', crm: 'CRM', workspace: 'Workspace' };

/**
 * Each filing kind's checklist (#1693 decision 8). The last step is done when
 * a proof is stored; the others are rows of `formation_step_checks` by key.
 */
export const FILING_CHECKLIST: Record<string, ReadonlyArray<readonly [string, string]>> = {
  '83b': [['fill', 'Fill the election'], ['mail', 'Mail by certified post'], ['proof', 'Upload proof of mailing']],
  ein: [['apply', 'Apply for the EIN'], ['proof', 'Upload the EIN letter']],
  other: [['submit', 'Submit the filing'], ['proof', 'Upload the confirmation']],
};

const known = <T,>(map: Record<string, T>, key: unknown): T | null => typeof key === 'string' && Object.hasOwn(map, key) ? map[key] : null;
const fact = (label: string, value: string | number | null | undefined, reason: string): RecordFact =>
  value == null || value === '' ? { label, value: null, reason } : { label, value };
const notRecorded = (reason: string): Section => ({ rows: [{ a: 'Not recorded', b: reason, tone: 'grey' }] });
const rowsOf = <T,>(r: { results?: T[] | null }): T[] => r.results ?? [];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const percent = (n: number) => `${Math.round(n * 100) / 100}%`;
const numericId = (id: string, prefix = '') => Number(id.slice(prefix.length));

function dateOnly(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  const day = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day ? null : date;
}
const longDate = (date: Date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
function dateText(raw: unknown): string | null {
  const date = dateOnly(raw);
  return date ? longDate(date) : null;
}
/** "12 Oct 2026 · 09:41" from a stored UTC timestamp, or the day alone. */
function stampText(raw: unknown): string | null {
  const day = dateText(raw);
  if (!day) return null;
  const time = /^\d{4}-\d{2}-\d{2}[ T](\d{2}:\d{2})/.exec(String(raw))?.[1];
  return time ? `${day} · ${time}` : day;
}
function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function daysUntil(raw: unknown): number | null {
  const date = dateOnly(raw);
  return date ? Math.round((date.getTime() - todayUtc().getTime()) / 86400000) : null;
}
function addMonths(date: Date, months: number): Date {
  const out = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(date.getUTCDate(), last));
  return out;
}
function monthsBetween(from: Date, to: Date): number {
  const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
  return to.getUTCDate() < from.getUTCDate() ? months - 1 : months;
}
const recordHref = (slug: string, id: string | number, projectId: number) => `/build/${slug}/${id}?project=${projectId}`;
// Build's Connect a tool for one tool, keeping the venture, as the module
// read's links do (cycle_build.ts, D686 §5.4).
const connectHref = (providerKey: string, projectId: number) =>
  `/build/connect?tool=${encodeURIComponent(providerKey)}&project_id=${encodeURIComponent(String(projectId))}`;

async function projectRow(ctx: RecordContext): Promise<{ company_id: number | null; entity_id: number | null }> {
  return await ctx.env.DB.prepare('SELECT company_id, entity_id FROM projects WHERE id = ?')
    .bind(ctx.projectId).first<{ company_id: number | null; entity_id: number | null }>() ?? { company_id: null, entity_id: null };
}

// ── Solution design and Prototype / MVP: one feature ─────────────────────────

/** Today's feature row, scoped to the venture. `ownedRow` has already run. */
async function featureRow(ctx: RecordContext, id: string): Promise<Any> {
  const row = await ctx.env.DB.prepare(
    `SELECT f.id, f.title, f.added_value, f.effort, f.scope, f.description, f.is_must_have, f.delivery_status, f.due_date,
            f.hypothesis_id, f.created_by, f.created_at, pg.title AS pain_theme, h.claim AS hypothesis, u.name AS owner
       FROM mvp_features f
       LEFT JOIN pain_groups pg ON pg.id = f.pain_group_id AND pg.project_id = f.project_id
       LEFT JOIN hypotheses h ON h.id = f.hypothesis_id AND h.project_id = f.project_id
       LEFT JOIN users u ON u.id = f.owner_user_id
      WHERE f.id = ? AND f.project_id = ?`,
  ).bind(numericId(id), ctx.projectId).first<Any>();
  if (!row) throw new Error('Build feature vanished after its ownership check');
  return row;
}

/** Decision 2: Impact is added_value; Effort is effort (S, M, L; an old XL is High); a NULL scope reads from the tier. */
function featureLevels(f: Any): { impact: string | null; effort: string | null; outOfScope: boolean } {
  const impact = known(IMPACT_KEY, f.added_value), effort = known(EFFORT_KEY, f.effort);
  const outOfScope = f.scope === 'out' || (f.scope == null && impact === 'low');
  return { impact: impact ? LEVEL[impact] : f.added_value ?? null, effort: effort ? LEVEL[effort] : f.effort ?? null, outOfScope };
}

const solutionDesign: ModuleSpec = {
  read: 'read', write: 'write', store: 'mvp_features',
  oldRows: { actions: ['build_feature_details_changed'] },
  async record(ctx, id): Promise<RecordContent> {
    const f = await featureRow(ctx, id);
    const { impact, effort, outOfScope } = featureLevels(f);
    const links = [f.pain_theme != null ? `Answers ${f.pain_theme}` : null, f.hypothesis != null ? `tests ${f.hypothesis}` : null].filter(Boolean) as string[];
    const sub = links.length ? links.join(' · ').replace(/^t/, 'T') : 'Links to nothing';
    return {
      title: f.title, sub,
      pills: [
        ...(links.length ? [] : [{ text: 'Links to nothing', tone: 'bad' }]),
        ...(impact ? [{ text: `${impact} impact`, tone: impact === 'High' ? 'ok' : 'grey' }] : []),
        ...(effort ? [{ text: `${effort} effort`, tone: 'grey' }] : []),
        ...(outOfScope ? [{ text: 'Out of scope', tone: 'grey' }] : []),
      ],
      facts: [
        fact('Pain theme', f.pain_theme, 'Not linked to a pain theme.'),
        fact('Hypothesis', f.hypothesis, 'Not linked to a hypothesis.'),
        fact('Impact', impact, 'No impact recorded.'),
        fact('Effort', effort, 'No effort recorded.'),
      ],
      createdBy: f.created_by ?? null, createdAt: f.created_at ?? null,
    };
  },
  sections: [
    { key: 'description', title: 'Description', async read(ctx, id) {
      const f = await featureRow(ctx, id);
      return typeof f.description === 'string' && f.description.trim() ? { rows: [{ a: f.description }] } : { rows: [], empty: 'No description recorded.' };
    } },
    { key: 'risks', title: 'Risks', async read(ctx, id) {
      const risks = rowsOf(await ctx.env.DB.prepare(
        `SELECT r.title, r.severity, u.name AS owner FROM venture_risks r LEFT JOIN users u ON u.id = r.owner_user_id
          WHERE r.feature_id = ? AND r.project_id = ? ORDER BY r.id`,
      ).bind(numericId(id), ctx.projectId).all<Any>());
      return { rows: risks.map(r => ({ a: r.title, b: r.owner ?? 'No owner', c: LEVEL[r.severity] ?? r.severity ?? 'Not recorded', tone: SEVERITY_TONE[r.severity] ?? 'grey' })),
        empty: 'No risks tied to this feature.' };
    } },
    { key: 'appears_in', title: 'Appears in', side: true, async read(ctx, id) {
      const f = await featureRow(ctx, id);
      const items = rowsOf(await ctx.env.DB.prepare(
        'SELECT id, objective, kanban_status FROM roadmap_okrs WHERE project_id = ? AND feature_id = ? ORDER BY sort_order, id',
      ).bind(ctx.projectId, f.id).all<Any>());
      const rows: Row[] = [];
      if (Number(f.is_must_have) === 1) rows.push({ a: 'Prototype / MVP', b: 'Must-have', href: recordHref('prototype-mvp', f.id, ctx.projectId) });
      for (const item of items) rows.push({ a: 'Roadmap', b: `${item.objective} · ${COLUMN_LABEL[item.kanban_status] ?? 'No column'}`, href: recordHref('product-roadmap', item.id, ctx.projectId) });
      return { rows, empty: 'Not on the MVP or the roadmap.' };
    } },
    { key: 'brief', title: 'Brief', side: true, async read() { return notRecorded('No brief is stored for a feature.'); } },
  ],
  async actions() { return []; },
};

/** Decision 7's "#<n>" of a GitHub ledger key, `issue:<owner>/<repo>#<n>` or `pull:...`. */
function ledgerLabel(ref: string): string | null {
  const m = /^(issue|pull):[^#]+#(\d+)$/.exec(ref);
  return m ? `${m[1] === 'issue' ? 'issue' : 'pull request'} #${m[2]}` : null;
}

const prototypeMvp: ModuleSpec = {
  read: 'read', write: 'write', store: 'mvp_must_haves',
  // Decision 15: a feature and its must-have show one history.
  activityType: 'build.solution-design',
  oldRows: { actions: ['build_feature_details_changed'] },
  async record(ctx, id): Promise<RecordContent> {
    const f = await featureRow(ctx, id);
    const state = known(MUST_KEY, f.delivery_status);
    const done = await ctx.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM mvp_test_sessions WHERE feature_id = ? AND project_id = ? AND status = 'done'",
    ).bind(f.id, ctx.projectId).first<{ n: number }>();
    const due = dateText(f.due_date);
    const sub = [f.hypothesis != null ? `Tests ${f.hypothesis}` : null, due ? `due ${due}` : null].filter(Boolean).join(' · ').replace(/^d/, 'D');
    return {
      title: f.title, sub: sub || 'No hypothesis or due date recorded',
      pills: state ? [{ text: MUST_LABEL[state], tone: MUST_TONE[state] }] : f.delivery_status ? [String(f.delivery_status)] : [],
      facts: [
        fact('Owner', f.owner, 'No owner recorded.'),
        fact('Due', due, 'No due date recorded.'),
        fact('Hypothesis', f.hypothesis, 'Not linked to a hypothesis.'),
        fact('Tests run', Number(done?.n ?? 0) || null, 'No test session is done yet.'),
      ],
      createdBy: f.created_by ?? null, createdAt: f.created_at ?? null,
    };
  },
  sections: [
    { key: 'sessions', title: 'Test sessions', async read(ctx, id) {
      const sessions = rowsOf(await ctx.env.DB.prepare(
        `SELECT s.title, s.held_on, s.status, (SELECT COUNT(*) FROM mvp_test_findings t WHERE t.session_id = s.id) AS findings
           FROM mvp_test_sessions s WHERE s.feature_id = ? AND s.project_id = ? ORDER BY s.held_on IS NULL, s.held_on, s.id`,
      ).bind(numericId(id), ctx.projectId).all<Any>());
      return { rows: sessions.map(s => {
        const on = dateText(s.held_on);
        return { a: on ? `${s.title} · ${on}` : s.title, b: plural(Number(s.findings), 'finding'),
          c: s.status === 'done' ? 'Done' : 'Planned', tone: s.status === 'done' ? 'ok' : 'grey' };
      }), empty: 'No test sessions yet.' };
    } },
    { key: 'findings', title: 'Findings', async read(ctx, id) {
      const findings = rowsOf(await ctx.env.DB.prepare(
        `SELECT t.text, t.direction, t.kept, h.claim AS hypothesis
           FROM mvp_test_findings t JOIN mvp_test_sessions s ON s.id = t.session_id
           LEFT JOIN hypotheses h ON h.id = t.hypothesis_id AND h.project_id = s.project_id
          WHERE s.feature_id = ? AND s.project_id = ? ORDER BY t.id`,
      ).bind(numericId(id), ctx.projectId).all<Any>());
      return { rows: findings.map(t => ({ a: t.text, b: t.hypothesis != null ? `${t.direction} ${t.hypothesis}` : t.direction,
        c: Number(t.kept) === 1 ? 'Kept' : 'Flagged', tone: Number(t.kept) === 1 ? 'ok' : 'bad' })), empty: 'No findings yet.' };
    } },
    { key: 'linked', title: 'Linked', side: true, async read(ctx, id) {
      // Decision 7: the attached URLs. A GitHub link reads synced when this
      // venture's ledger holds its key; a must-have the GitHub sync made also
      // shows its pull request from the ledger.
      const links = rowsOf(await ctx.env.DB.prepare(
        `SELECT l.kind, l.url, l.external_ref, ledger.last_seen_at
           FROM mvp_feature_links l
           LEFT JOIN connector_fed_items ledger ON ledger.external_id = l.external_ref AND ledger.project_id = ?
          WHERE l.feature_id = ? ORDER BY l.id`,
      ).bind(ctx.projectId, numericId(id)).all<Any>());
      const pulls = rowsOf(await ctx.env.DB.prepare(
        `SELECT external_id, last_seen_at FROM connector_fed_items
          WHERE project_id = ? AND local_table = 'mvp_features' AND local_id = ? AND kind = 'pull_request' ORDER BY id`,
      ).bind(ctx.projectId, numericId(id)).all<Any>());
      const rows: Row[] = links.map(l => {
        if (l.kind === 'figma') return { a: 'Figma', b: 'Sync not recorded: Figma’s connector is not built', href: l.url };
        const label = (l.external_ref && ledgerLabel(l.external_ref)) || 'link';
        const synced = l.last_seen_at ? dateText(l.last_seen_at) : null;
        return { a: 'GitHub', b: synced ? `${label} · synced ${synced}` : `${label} · Not synced`, href: l.url };
      });
      const attached = new Set(links.map(l => l.external_ref).filter(Boolean));
      for (const p of pulls) {
        if (attached.has(p.external_id)) continue;
        const synced = dateText(p.last_seen_at);
        rows.push({ a: 'GitHub', b: `${ledgerLabel(p.external_id) ?? 'pull request'}${synced ? ` · synced ${synced}` : ''}` });
      }
      return { rows, empty: 'No design or code linked.' };
    } },
    { key: 'release', title: 'Release checklist', side: true, async read(ctx, id) {
      const checks = rowsOf(await ctx.env.DB.prepare(
        'SELECT label, done_at FROM mvp_release_checks WHERE feature_id = ? ORDER BY id',
      ).bind(numericId(id)).all<Any>());
      if (!checks.length) return { rows: [], empty: 'No release checks yet.' };
      const done = checks.filter(k => k.done_at).length;
      return { rows: [{ a: 'Done', b: `${done} of ${checks.length}` },
        ...checks.map(k => ({ a: k.label, c: k.done_at ? 'Done' : 'Open', tone: k.done_at ? 'ok' : 'grey' }))] };
    } },
  ],
  async actions() { return []; },
};

// ── Product roadmap: one item ────────────────────────────────────────────────

async function roadmapRow(ctx: RecordContext, id: string): Promise<Any> {
  const row = await ctx.env.DB.prepare(
    `SELECT o.id, o.objective, o.kanban_status, o.kpi_key, o.feedback_theme, o.target_date, o.created_by, o.created_at, u.name AS owner
       FROM roadmap_okrs o LEFT JOIN users u ON u.id = o.owner_user_id WHERE o.id = ? AND o.project_id = ?`,
  ).bind(numericId(id), ctx.projectId).first<Any>();
  if (!row) throw new Error('Build roadmap item vanished after its ownership check');
  return row;
}

const productRoadmap: ModuleSpec = {
  read: 'read', write: 'write', store: 'roadmap_okrs',
  oldRows: { actions: ['build_roadmap_details_changed'] },
  async record(ctx, id): Promise<RecordContent> {
    const o = await roadmapRow(ctx, id);
    const column = COLUMN_LABEL[o.kanban_status] ?? null;
    const sub = [column, o.kpi_key ? `moves ${o.kpi_key}` : null, o.owner ? `owner ${o.owner}` : null].filter(Boolean).join(' · ');
    return {
      title: o.objective, sub: sub || 'No column, KPI or owner recorded',
      pills: column ? [{ text: column, tone: 'vio' }] : [],
      facts: [
        fact('Column', column, 'No column recorded.'),
        fact('Moves', o.kpi_key, 'No KPI recorded.'),
        fact('Answers', o.feedback_theme, 'No feedback theme recorded.'),
        fact('Date', dateText(o.target_date), 'No date recorded.'),
      ],
      createdBy: o.created_by ?? null, createdAt: o.created_at ?? null,
    };
  },
  sections: [
    { key: 'dependencies', title: 'Dependencies', async read(ctx, id) {
      // Decision 4: "Waits on X" is an edge from X (okr_id) to this item (blocks_okr_id).
      const n = numericId(id);
      const edges = rowsOf(await ctx.env.DB.prepare(
        `SELECT CASE WHEN d.blocks_okr_id = ? THEN 'waits' ELSE 'blocks' END AS way, o.id, o.objective, o.kanban_status
           FROM okr_dependencies d
           JOIN roadmap_okrs o ON o.id = CASE WHEN d.blocks_okr_id = ? THEN d.okr_id ELSE d.blocks_okr_id END AND o.project_id = d.project_id
          WHERE d.project_id = ? AND (d.blocks_okr_id = ? OR d.okr_id = ?) ORDER BY way DESC, d.id`,
      ).bind(n, n, ctx.projectId, n, n).all<Any>());
      return { rows: edges.map(e => {
        const column = COLUMN_LABEL[e.kanban_status] ?? 'No column';
        const href = recordHref('product-roadmap', e.id, ctx.projectId);
        if (e.way === 'blocks') return { a: `Blocks ${e.objective}`, b: column, href };
        const done = e.kanban_status === 'done';
        return { a: `Waits on ${e.objective}`, b: column, c: done ? 'Done' : 'Open', tone: done ? 'ok' : 'amb', href };
      }), empty: 'No dependencies.' };
    } },
    { key: 'feedback', title: 'Feedback it answers', async read(ctx, id) {
      // The sender's name and date only: the email is never read.
      const feedback = rowsOf(await ctx.env.DB.prepare(
        `SELECT body, from_name, theme, created_at FROM product_feedback
          WHERE project_id = ? AND roadmap_item_ref = ? ORDER BY created_at DESC, id DESC LIMIT 20`,
      ).bind(ctx.projectId, String(numericId(id))).all<Any>());
      return { rows: feedback.map(f => ({ a: `“${f.body}”`, b: [f.from_name || 'Unnamed', dateText(f.created_at)].filter(Boolean).join(' · '),
        ...(f.theme ? { c: f.theme, tone: 'vio' } : {}) })), empty: 'No feedback answered by this item.' };
    } },
    { key: 'github', title: 'GitHub', side: true, async read(ctx, id) {
      const issue = await ctx.env.DB.prepare(
        `SELECT external_id, last_seen_at FROM connector_fed_items
          WHERE project_id = ? AND local_table = 'roadmap_okrs' AND local_id = ? AND kind = 'issue' ORDER BY id DESC LIMIT 1`,
      ).bind(ctx.projectId, numericId(id)).first<Any>();
      if (!issue) return notRecorded('No GitHub issue is synced to this item.');
      const label = ledgerLabel(issue.external_id) ?? 'issue';
      const synced = dateText(issue.last_seen_at);
      return { rows: [{ a: label.replace(/^i/, 'I'), b: synced ? `synced ${synced}` : 'Not synced' },
        { a: 'State', b: 'Not recorded: the sync stores no issue state.', tone: 'grey' }] };
    } },
    { key: 'public', title: 'Public roadmap', side: true, async read() { return notRecorded('Ventures have no public roadmap page.'); } },
  ],
  async actions() { return []; },
};

// ── Founding team: one founder ───────────────────────────────────────────────

/**
 * Vesting belongs to a holder, but its own row is user-keyed. Both keys must
 * agree, so a founder's other company's schedule is never joined. A read only.
 */
async function founderRow(ctx: RecordContext, id: string): Promise<Any> {
  const row = await ctx.env.DB.prepare(
    `SELECT h.id, h.user_id, h.name, h.founder_role, h.ownership_pct, h.shares, h.security_type, h.kind, h.created_at,
            v.start_date, v.cliff_months, v.total_months, v.vested_shares
       FROM cap_table_holders h
       LEFT JOIN cap_table_vesting v ON v.holder_id = h.id AND v.user_id = h.user_id
      WHERE h.project_id = ? AND h.id = ? AND h.founder_role IS NOT NULL`,
  ).bind(ctx.projectId, numericId(id, 'h-')).first<Any>();
  if (!row) throw new Error('Build founder vanished after its ownership check');
  return row;
}

async function agreementOf(ctx: RecordContext, userId: unknown): Promise<Any | null> {
  if (userId == null) return null;
  return await ctx.env.DB.prepare(
    `SELECT d.status, d.signed_at, d.created_at FROM documents d
       JOIN cofounder_agreement_parties party ON party.document_id = d.id
      WHERE d.project_id = ? AND d.template_name = 'cofounder_agreement' AND party.user_id = ?
      ORDER BY d.created_at DESC, d.id DESC LIMIT 1`,
  ).bind(ctx.projectId, userId).first<Any>() ?? null;
}

/** Stored vested shares over shares when recorded; else the schedule: 0 before the cliff, then months elapsed over total. */
function vestedToday(h: Any): string | null {
  if (h.vested_shares != null && Number(h.shares) > 0) return percent(Math.min(100, 100 * Number(h.vested_shares) / Number(h.shares)));
  const start = dateOnly(h.start_date), total = Number(h.total_months);
  if (!start || !Number.isFinite(total) || total <= 0) return null;
  const elapsed = monthsBetween(start, todayUtc());
  if (elapsed < Number(h.cliff_months ?? 0) || elapsed < 0) return '0%';
  return percent(Math.min(100, 100 * elapsed / total));
}

function vestingText(h: Any): string | null {
  const start = dateOnly(h.start_date);
  if (!start) return null;
  const total = h.total_months == null ? null : Number(h.total_months), cliff = h.cliff_months == null ? null : Number(h.cliff_months);
  const years = total != null && Number.isFinite(total) && total > 0 ? Math.round(total / 12 * 100) / 100 : null;
  const length = years == null ? 'length not recorded' : `${years} ${years === 1 ? 'year' : 'years'}`;
  const cliffText = cliff == null || !Number.isFinite(cliff) ? 'cliff not recorded' : cliff === 0 ? 'no cliff' : `cliff ${longDate(addMonths(start, cliff))}`;
  return `${length} · ${cliffText}`;
}

const foundingTeam: ModuleSpec = {
  read: 'read', write: 'write', store: 'cap_table_founders',
  oldRows: { actions: ['build_founder_role_changed'], idWithoutPrefix: 'h-' },
  async record(ctx, id): Promise<RecordContent> {
    const h = await founderRow(ctx, id);
    const agreement = await agreementOf(ctx, h.user_id);
    const equity = h.ownership_pct == null ? null : percent(Number(h.ownership_pct));
    const since = dateText(h.start_date);
    const sub = [h.founder_role, equity, since ? `vesting since ${since}` : null].filter(Boolean).join(' · ');
    return {
      title: h.name, sub: sub || 'No role, equity or vesting recorded',
      pills: agreement == null ? [] : agreement.status === 'signed' ? [{ text: 'Agreement signed', tone: 'ok' }] : [{ text: 'Agreement awaiting', tone: 'amb' }],
      facts: [
        fact('Role', h.founder_role, 'No role recorded.'),
        fact('Equity', equity, 'No ownership percentage recorded.'),
        fact('Vesting', vestingText(h), 'No vesting schedule recorded.'),
        fact('Vested today', vestedToday(h), 'No vesting schedule recorded.'),
      ],
      createdAt: h.created_at ?? null,
    };
  },
  sections: [
    { key: 'timeline', title: 'Vesting timeline', async read(ctx, id) {
      const h = await founderRow(ctx, id);
      const start = dateOnly(h.start_date);
      if (!start) return notRecorded('No vesting schedule recorded.');
      const today = todayUtc();
      const point = (label: string, months: unknown): Row | null => {
        const n = months == null ? NaN : Number(months);
        if (!Number.isFinite(n) || n < 0) return { a: label, b: 'Not recorded' };
        const at = addMonths(start, n);
        return { a: label, b: longDate(at), c: at > today ? 'Upcoming' : 'Passed', tone: at > today ? 'grey' : 'ok' };
      };
      return { rows: [Number(h.cliff_months) === 0 ? null : point('Cliff', h.cliff_months), point('Fully vested', h.total_months)].filter(Boolean) as Row[] };
    } },
    { key: 'contributions', title: 'Contributions', async read(ctx, id) {
      const list = rowsOf(await ctx.env.DB.prepare(
        'SELECT text, on_date FROM founder_contributions WHERE project_id = ? AND holder_id = ? ORDER BY on_date IS NULL, on_date DESC, id DESC',
      ).bind(ctx.projectId, numericId(id, 'h-')).all<Any>());
      return { rows: list.map(k => ({ a: k.text, ...(dateText(k.on_date) ? { b: dateText(k.on_date)! } : {}) })), empty: 'No contributions logged yet.' };
    } },
    { key: 'documents', title: 'Documents', side: true, gate: 'write', async read(ctx, id) {
      const h = await founderRow(ctx, id);
      const rows: Row[] = [];
      const agreement = await agreementOf(ctx, h.user_id);
      if (agreement) {
        const on = dateText(agreement.status === 'signed' ? agreement.signed_at ?? agreement.created_at : agreement.created_at);
        rows.push({ a: 'Co-founder agreement', b: [agreement.status === 'signed' ? 'Signed' : 'Awaiting', on].filter(Boolean).join(' · ') });
      }
      const election = await ctx.env.DB.prepare(
        "SELECT id, due_date, state FROM formation_steps WHERE project_id = ? AND kind = '83b' AND for_holder_id = ? ORDER BY id DESC LIMIT 1",
      ).bind(ctx.projectId, h.id).first<Any>();
      if (election) {
        const due = dateText(election.due_date);
        rows.push({ a: '83(b)', b: election.state === 'done' ? 'Filed' : due ? `Due ${due}` : 'No due date recorded',
          href: recordHref('company-creation', `step-${election.id}`, ctx.projectId) });
      }
      return { rows, empty: 'No documents recorded.' };
    } },
    { key: 'cap_table', title: 'Cap table', side: true, async read(ctx, id) {
      const h = await founderRow(ctx, id);
      const kind = String(h.security_type ?? h.kind ?? 'Shares');
      return { rows: [{ a: kind.charAt(0).toUpperCase() + kind.slice(1).replace(/_/g, ' '),
        b: h.shares == null ? 'Shares not recorded' : `${Number(h.shares).toLocaleString('en-US')} shares` }] };
    } },
  ],
  async actions(): Promise<RecordAction[]> {
    return [{ key: 'edit-split', label: 'Edit split', kind: 'link', href: '/raise/capital/cap-table' }];
  },
};

// ── Company creation: one filing (step-, obligation- or lab-) ────────────────

type Filing = {
  source: 'step' | 'obligation' | 'lab';
  title: string; kind: string | null; jurisdiction: string | null; due: string | null; date?: string | null;
  done: boolean; proofKey: string | null; status?: string; forHolderId?: number | null; stepId?: number;
  createdBy?: number | null; createdAt?: string | null;
  lab?: Array<{ label: string; date: string | null }>;
};

async function filingOf(ctx: RecordContext, id: string): Promise<Filing> {
  const db = ctx.env.DB;
  if (id.startsWith('step-')) {
    const s = await db.prepare(
      'SELECT id, title, due_date, state, proof_file_key, kind, jurisdiction, for_holder_id, created_by, created_at FROM formation_steps WHERE id = ? AND project_id = ?',
    ).bind(numericId(id, 'step-'), ctx.projectId).first<Any>();
    if (s) return { source: 'step', title: s.title, kind: s.kind ?? null, jurisdiction: s.jurisdiction ?? null, due: s.due_date ?? null,
      done: s.state === 'done', proofKey: s.proof_file_key ?? null, forHolderId: s.for_holder_id ?? null, stepId: s.id,
      createdBy: s.created_by ?? null, createdAt: s.created_at ?? null };
  } else if (id.startsWith('obligation-')) {
    const o = await db.prepare(
      `SELECT o.title, o.due_date, o.status, o.proof_file_key, o.kind, o.created_at, e.jurisdiction
         FROM entity_obligations o JOIN entities e ON e.id = o.entity_id
         JOIN projects p ON p.entity_id = o.entity_id
        WHERE o.id = ? AND p.id = ?`,
    ).bind(numericId(id, 'obligation-'), ctx.projectId).first<Any>();
    if (o) return { source: 'obligation', title: o.title, kind: o.kind ?? null, jurisdiction: o.jurisdiction ?? null, due: o.due_date ?? null,
      done: false, status: o.status, proofKey: o.proof_file_key ?? null, createdAt: o.created_at ?? null };
  } else {
    const m = /^lab-(\d+)-([0-2])$/.exec(id);
    const order = m ? await db.prepare(
      'SELECT paid_at, packet_ready_at, filed_on, jurisdiction_id, created_at FROM incorporations WHERE id = ? AND project_id = ?',
    ).bind(Number(m[1]), ctx.projectId).first<Any>() : null;
    if (m && order) {
      const lab = [order.paid_at, order.packet_ready_at, order.filed_on].map((date, n) => ({ label: LAB_STEPS[n], date: date ?? null }));
      const step = lab[Number(m[2])];
      return { source: 'lab', title: step.label, kind: 'formation', jurisdiction: order.jurisdiction_id ?? null, due: step.date,
        date: step.date, done: !!step.date, proofKey: null, createdAt: order.created_at ?? null, lab };
    }
  }
  throw new Error('Build filing vanished after its ownership check');
}

/** Decision 8: Filed when done, Overdue past due, Due soon within 30 days, else Upcoming. */
function filingState(f: Filing): 'filed' | 'overdue' | 'due_soon' | 'upcoming' {
  if (f.done) return 'filed';
  const days = daysUntil(f.due);
  return days == null ? 'upcoming' : days < 0 ? 'overdue' : days <= 30 ? 'due_soon' : 'upcoming';
}
function filingLabel(f: Filing, state: string): string {
  if (state === 'filed') return f.kind === 'ein' && f.source === 'step' ? 'Issued' : 'Filed';
  if (state === 'overdue') return 'Overdue';
  if (state === 'upcoming') return 'Upcoming';
  const days = daysUntil(f.due)!;
  return days === 0 ? 'Due today' : `Due in ${plural(days, 'day')}`;
}
const proofStored = (key: string | null) => typeof key === 'string' && key.startsWith('build-proof/');

const companyCreation: ModuleSpec = {
  read: 'read', write: 'write', store: 'build_filings',
  // One prefix per spec (S1, 2026-10-17): an old obligation-proof row reads on
  // no record, since obligation 5 and step 5 can share a number.
  oldRows: { actions: ['build_formation_step_created', 'build_formation_step_changed'], idWithoutPrefix: 'step-' },
  async record(ctx, id): Promise<RecordContent> {
    const f = await filingOf(ctx, id);
    const state = filingState(f);
    const due = dateText(f.due), days = daysUntil(f.due);
    const sub = state === 'filed'
      ? (f.date && dateText(f.date) ? `${filingLabel(f, state)} ${dateText(f.date)}` : `${filingLabel(f, state)} · date not recorded`)
      : due && days != null
        ? `Due ${due} · ${days < 0 ? `${plural(-days, 'day')} overdue` : days === 0 ? 'due today' : `${plural(days, 'day')} left`}`
        : 'No due date recorded';
    const proof = typeof f.proofKey === 'string' && f.proofKey ? (proofStored(f.proofKey) ? 'Stored' : 'Key recorded') : null;
    return {
      title: f.title, sub,
      pills: [{ text: filingLabel(f, state), tone: FILING_TONE[state] }],
      facts: [
        fact('Filing', known(FILING_KIND, f.kind) ?? f.title, 'No filing kind recorded.'),
        fact('Jurisdiction', f.jurisdiction, 'No jurisdiction recorded.'),
        fact('Due', due, 'No due date recorded.'),
        fact('Proof', proof, f.source === 'lab' && f.done ? 'The Lab keeps this filing’s record.' : 'Not filed yet'),
      ],
      createdBy: f.createdBy ?? null, createdAt: f.createdAt ?? null,
    };
  },
  sections: [
    { key: 'steps', title: 'Steps', async read(ctx, id) {
      const f = await filingOf(ctx, id);
      if (f.source === 'lab') return { rows: f.lab!.map(s => ({ a: s.label, b: dateText(s.date) ?? '', c: s.date ? 'Done' : 'Open', tone: s.date ? 'ok' : 'grey' })) };
      const list = FILING_CHECKLIST[f.kind === '83b' || f.kind === 'ein' ? f.kind : 'other'];
      const checked = new Set(f.stepId == null ? [] : rowsOf(await ctx.env.DB.prepare(
        'SELECT key FROM formation_step_checks WHERE step_id = ? AND done_at IS NOT NULL',
      ).bind(f.stepId).all<{ key: string }>()).map(r => r.key));
      if (f.source === 'obligation' && f.status && f.status !== 'open') checked.add('submit');
      let firstOpen = true;
      return { rows: list.map(([key, label]) => {
        const done = key === 'proof' ? proofStored(f.proofKey) : checked.has(key);
        const tone = done ? 'ok' : firstOpen ? 'amb' : 'grey';
        if (!done) firstOpen = false;
        return { a: label, c: done ? 'Done' : 'Open', tone };
      }) };
    } },
    { key: 'reminders', title: 'Reminders', async read() { return notRecorded('No reminder is sent for filings.'); } },
    { key: 'linked', title: 'Linked', side: true, async read(ctx, id) {
      const f = await filingOf(ctx, id);
      const rows: Row[] = [];
      // Decision 9: a Lab row is read-only; its link is a row, not an action.
      if (f.source === 'lab') rows.push({ a: 'Incorporation', b: 'Open in the Legal engine', href: '/raise/legal-engine/incorporation' });
      if (f.forHolderId != null) {
        const holder = await ctx.env.DB.prepare(
          'SELECT id, name FROM cap_table_holders WHERE id = ? AND project_id = ? AND founder_role IS NOT NULL',
        ).bind(f.forHolderId, ctx.projectId).first<Any>();
        if (holder) rows.push({ a: 'Founder stock', b: holder.name, href: recordHref('founding-team', `h-${holder.id}`, ctx.projectId) });
      }
      if (canWrite(ctx.project, ctx.user)) {
        const docs = rowsOf(await ctx.env.DB.prepare(
          'SELECT title FROM documents WHERE project_id = ? AND title IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 5',
        ).bind(ctx.projectId).all<{ title: string }>());
        if (docs.length) rows.push({ a: 'Document vault', b: [...new Set(docs.map(d => d.title))].join(' · ') });
      }
      return { rows, empty: 'Nothing linked.' };
    } },
  ],
  // Decision 9: no action is declared here; #1695 adds Mark filed (steps only) and Upload proof.
  async actions() { return []; },
};

// ── Operating systems: one system kind ───────────────────────────────────────

type System = {
  kind: SystemKind; companyId: number | null;
  feeds: string[]; providerKey: string | null; provider: string | null;
  connection: Any | null; workspace: boolean;
};

function feedsOf(raw: unknown): string[] {
  try {
    const list = typeof raw === 'string' ? JSON.parse(raw) : null;
    return Array.isArray(list) ? [...new Set(list.filter((key): key is string => typeof key === 'string' && Object.hasOwn(FEEDS_LABEL, key)))] : [];
  } catch { return []; }
}
function syncOf(configJson: unknown): string {
  try {
    const config = typeof configJson === 'string' ? JSON.parse(configJson) : null;
    return Object.hasOwn(SYNC_LABEL, config?.sync_frequency) ? config.sync_frequency : 'live';
  } catch { return 'live'; }
}
async function workspaceConnected(env: Env, userId: number, providerKey: string): Promise<boolean> {
  if (providerKey === 'google_calendar') return !!await env.DB.prepare('SELECT 1 FROM google_oauth_tokens WHERE user_id = ?').bind(userId).first();
  if (providerKey === 'microsoft_365') return !!await env.DB.prepare('SELECT 1 FROM microsoft_oauth_tokens WHERE user_id = ?').bind(userId).first();
  return false;
}

/**
 * The kind's mapping as the list reads it: a connection counts only while it
 * is enabled for the venture's company and its owner is a member. Decision 11:
 * the provider is the catalogue name unless the viewer owns the connection.
 */
async function systemOf(ctx: RecordContext, id: string): Promise<System> {
  const kind = id as SystemKind;
  const { company_id: companyId } = await projectRow(ctx);
  const base: System = { kind, companyId, feeds: [], providerKey: null, provider: null, connection: null, workspace: kind === 'workspace' };
  if (companyId == null) return base;
  const row = await ctx.env.DB.prepare(
    `SELECT s.feeds_json, s.provider_key AS workspace_provider, s.updated_by,
            i.id, i.user_id, i.provider_key, i.display_name, i.status, i.last_synced_at, i.created_at, i.config_json, i.scopes_json
       FROM project_core_systems s
       LEFT JOIN integrations i ON i.id = s.integration_id AND EXISTS (
         SELECT 1 FROM integration_companies ic JOIN user_company_links ucl ON ucl.company_id = ic.company_id AND ucl.user_id = i.user_id
          WHERE ic.integration_id = i.id AND ic.company_id = ? AND ic.enabled = 1)
      WHERE s.project_id = ? AND s.kind = ?`,
  ).bind(companyId, ctx.projectId, kind).first<Any>();
  if (!row) return base;
  base.feeds = feedsOf(row.feeds_json);
  if (kind === 'workspace') {
    const member = row.workspace_provider && row.updated_by != null && !!await ctx.env.DB.prepare(
      'SELECT 1 FROM user_company_links WHERE user_id = ? AND company_id = ?',
    ).bind(row.updated_by, companyId).first();
    if (member && await workspaceConnected(ctx.env, row.updated_by, row.workspace_provider)) {
      base.providerKey = row.workspace_provider;
      base.provider = getDescriptor(row.workspace_provider)?.display_name ?? row.workspace_provider;
      base.connection = { status: 'active' };
    }
    return base;
  }
  if (row.id == null) return base;
  base.providerKey = row.provider_key;
  base.provider = (row.user_id === ctx.user.id ? row.display_name : getDescriptor(row.provider_key)?.display_name) ?? row.provider_key;
  base.connection = row;
  return base;
}
function systemState(s: System): 'connected' | 'failing' | 'not_connected' {
  return !s.connection ? 'not_connected' : s.connection.status === 'error' ? 'failing' : s.connection.status === 'active' ? 'connected' : 'not_connected';
}
const STATE_LABEL = { connected: 'Connected', failing: 'Failing', not_connected: 'Not connected' } as const;
const STATE_TONE = { connected: 'ok', failing: 'bad', not_connected: 'grey' } as const;
const NO_ROW = 'Workspace has no connection row.';

const operatingSystems: ModuleSpec = {
  read: 'read', write: 'write', store: 'build_systems',
  oldRows: { actions: ['build_system_mapping_changed'] },
  async record(ctx, id): Promise<RecordContent> {
    const s = await systemOf(ctx, id);
    const state = systemState(s);
    const c = s.connection;
    const sub = !c ? 'Not connected yet'
      : s.workspace ? 'Connected · sync not recorded'
        : [dateText(c.created_at) ? `Connected ${dateText(c.created_at)}` : 'Connected',
          dateText(c.last_synced_at) ? `last good sync ${dateText(c.last_synced_at)}` : 'no sync recorded'].join(' · ');
    return {
      title: `${SYSTEM_LABEL[s.kind]} · ${s.provider ?? 'Not connected'}`, sub,
      pills: [{ text: STATE_LABEL[state], tone: STATE_TONE[state] }],
      facts: [
        fact('State', STATE_LABEL[state], ''),
        s.workspace ? fact('Last sync', null, NO_ROW) : fact('Last sync', stampText(c?.last_synced_at), c ? 'No sync recorded.' : 'Not connected yet.'),
        // Decision 5: the mapped connection's sync_frequency, live when unset.
        s.workspace ? fact('Sync', null, NO_ROW) : fact('Sync', c ? SYNC_LABEL[syncOf(c.config_json)] : null, 'Not connected yet.'),
        fact('Feeds', s.feeds.map(key => FEEDS_LABEL[key]).join(' · '), 'No feeds recorded.'),
      ],
    };
  },
  sections: [
    { key: 'sync_log', title: 'Sync log', gate: 'write', async read(ctx, id) {
      const s = await systemOf(ctx, id);
      if (s.workspace) return notRecorded(NO_ROW);
      if (!s.connection) return notRecorded('Not connected yet.');
      // Decision 11: date, event type and status only; never a summary or payload.
      const logs = rowsOf(await ctx.env.DB.prepare(
        'SELECT created_at, event_type, status FROM integration_logs WHERE integration_id = ? ORDER BY created_at DESC, id DESC LIMIT 20',
      ).bind(s.connection.id).all<Any>());
      return { rows: logs.map(l => {
        const ok = /^(ok|success)$/i.test(String(l.status)), failed = /^(error|failed|failure)$/i.test(String(l.status));
        return { a: stampText(l.created_at) ?? 'Date not recorded', b: l.event_type ?? 'Event not recorded',
          c: ok ? 'OK' : failed ? 'Failed' : String(l.status ?? 'Not recorded'), tone: ok ? 'ok' : failed ? 'bad' : 'grey' };
      }), empty: 'No sync recorded yet.' };
    } },
    { key: 'permissions', title: 'Permissions', gate: 'write', async read(ctx, id) {
      const s = await systemOf(ctx, id);
      if (s.workspace) return notRecorded(NO_ROW);
      if (!s.connection) return notRecorded('Not connected yet.');
      const lines = CONNECTOR_METADATA[s.providerKey!]?.permissions ?? [];
      const requested = getDescriptor(s.providerKey!)?.oauth_scopes ?? [];
      let granted: unknown = null;
      try { granted = s.connection.scopes_json ? JSON.parse(s.connection.scopes_json) : null; } catch { granted = null; }
      if (!Array.isArray(granted) || granted.length === 0) return notRecorded('The connector stored no granted scopes.');
      if (!requested.every(scope => (granted as unknown[]).includes(scope))) return notRecorded('Some requested scopes were not granted.');
      return { rows: lines.map(line => ({ a: line, c: 'Granted', tone: 'ok' })), empty: 'The connector lists no permissions.' };
    } },
    { key: 'companies', title: 'Companies', side: true, async read(ctx, id) {
      const s = await systemOf(ctx, id);
      if (s.companyId == null) return notRecorded('This project has no company scope for connectors.');
      if (s.workspace || !s.connection) {
        const own = await ctx.env.DB.prepare('SELECT company_name FROM company_profiles WHERE id = ?').bind(s.companyId).first<Any>();
        return s.connection ? { rows: [{ a: own?.company_name ?? 'This venture’s company', b: 'on' }] } : notRecorded('Not connected yet.');
      }
      // Decision 11: this venture's company, and others only where the viewer is a member.
      const list = rowsOf(await ctx.env.DB.prepare(
        `SELECT ic.company_id, ic.enabled, cp.company_name FROM integration_companies ic
           LEFT JOIN company_profiles cp ON cp.id = ic.company_id
          WHERE ic.integration_id = ? AND (ic.company_id = ? OR ic.company_id IN (SELECT company_id FROM user_company_links WHERE user_id = ?))
          ORDER BY ic.company_id = ? DESC, ic.company_id`,
      ).bind(s.connection.id, s.companyId, ctx.user.id, s.companyId).all<Any>());
      return { rows: list.map(k => ({ a: k.company_name ?? (k.company_id === s.companyId ? 'This venture’s company' : 'Company name not recorded'),
        b: Number(k.enabled) === 1 ? 'on' : 'off' })) };
    } },
  ],
  async actions(ctx, id): Promise<RecordAction[]> {
    // Decision 10: Reconnect links to the tool's Connect a tool, else Connect a tool for the venture.
    const s = await systemOf(ctx, id);
    const href = s.providerKey && /^[a-z0-9_]{1,80}$/.test(s.providerKey)
      ? connectHref(s.providerKey, ctx.projectId) : `/build/connect?project_id=${ctx.projectId}`;
    return [{ key: 'reconnect', label: 'Reconnect', kind: 'link', tone: 'primary', href }];
  },
};

export const BUILD_SPECS: Record<string, ModuleSpec> = {
  'solution-design': solutionDesign,
  'prototype-mvp': prototypeMvp,
  'product-roadmap': productRoadmap,
  'founding-team': foundingTeam,
  'company-creation': companyCreation,
  'operating-systems': operatingSystems,
};
