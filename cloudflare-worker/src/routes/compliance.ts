/**
 * T12 — Compliance calendar (port of backend/app/api/routes/compliance.py).
 *
 * Mounted at /api/compliance. The auto-seeder
 * `seedStandardEventsForJurisdiction` is exported below and is now
 * called by `legal.ts` `/incorporate/wizard` immediately after the
 * entity is created (faithful port of the FastAPI `legal.py` flow).
 * The UNIQUE(project_id, event_type, due_date) constraint on
 * compliance_events makes the seed idempotent — re-incorporating
 * the same jurisdiction is a safe no-op.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';

const compliance = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Standard recurring events per jurisdiction — direct port of
// backend/app/api/routes/compliance.py:STANDARD_EVENTS.
// `due_month`+`due_day` → fixed-calendar deadline (next occurrence).
// `offset_days`         → relative to incorporation date.
// ---------------------------------------------------------------------------
type StandardEventSpec = {
  event_type: string;
  title: string;
  description?: string;
  due_month?: number;
  due_day?: number;
  offset_days?: number;
  recurrence: 'annual' | 'quarterly' | 'monthly' | 'one_time';
};

export const STANDARD_EVENTS: Record<string, StandardEventSpec[]> = {
  us_de_ccorp: [
    { event_type: 'franchise_tax', title: 'Delaware franchise tax + annual report',
      description: 'File the annual report and pay franchise tax via the Delaware Division of Corporations. Min ~$450/yr for early-stage; due March 1.',
      due_month: 3, due_day: 1, recurrence: 'annual' },
    { event_type: 'registered_agent', title: 'Registered agent renewal',
      description: 'Renew your Delaware registered agent (~$100/yr).',
      offset_days: 365, recurrence: 'annual' },
    { event_type: 'board_meeting', title: 'Quarterly board meeting',
      description: 'Hold a quarterly board meeting and record minutes. Required for proper corporate hygiene under DGCL.',
      offset_days: 90, recurrence: 'quarterly' },
    { event_type: 'annual_report', title: 'Federal corporate tax (Form 1120)',
      description: 'File IRS Form 1120 by April 15 (or extension to October 15).',
      due_month: 4, due_day: 15, recurrence: 'annual' },
  ],
  us_de_llc: [
    { event_type: 'franchise_tax', title: 'Delaware LLC annual tax',
      description: 'Flat $300/yr Delaware LLC tax — due June 1.',
      due_month: 6, due_day: 1, recurrence: 'annual' },
    { event_type: 'registered_agent', title: 'Registered agent renewal',
      description: 'Renew your Delaware registered agent.',
      offset_days: 365, recurrence: 'annual' },
  ],
  uk_ltd: [
    { event_type: 'annual_report', title: 'Confirmation statement (Companies House)',
      description: 'File the annual confirmation statement (£34 online).',
      offset_days: 365, recurrence: 'annual' },
    { event_type: 'annual_report', title: 'Annual accounts',
      description: 'File annual accounts with Companies House (due 9 months after year end).',
      offset_days: 365 + 270, recurrence: 'annual' },
    { event_type: 'franchise_tax', title: 'Corporation tax (CT600)',
      description: 'File CT600 with HMRC within 12 months of year end.',
      offset_days: 365, recurrence: 'annual' },
  ],
  sg_pte: [
    { event_type: 'annual_report', title: 'ACRA annual return',
      description: 'Hold AGM and file annual return with ACRA.',
      offset_days: 365, recurrence: 'annual' },
    { event_type: 'franchise_tax', title: 'IRAS Form C-S / C',
      description: 'File estimated chargeable income (ECI) and Form C-S/C with IRAS.',
      due_month: 11, due_day: 30, recurrence: 'annual' },
    { event_type: 'registered_agent', title: 'Company secretary engagement',
      description: 'Renew company secretary + nominee director services.',
      offset_days: 365, recurrence: 'annual' },
  ],
  ee_oy: [
    { event_type: 'annual_report', title: 'Estonian Business Register annual report',
      description: 'Submit annual accounts within 6 months of year end.',
      offset_days: 365, recurrence: 'annual' },
    { event_type: 'registered_agent', title: 'Contact person + e-Residency renewal',
      description: 'Renew contact-person service and e-Residency card if expiring.',
      offset_days: 365, recurrence: 'annual' },
  ],
};

/**
 * Compute next occurrence of a fixed-calendar deadline (e.g. March 1).
 * Returns this year's date if still upcoming, otherwise next year.
 * Day clamps to 28 on invalid (Feb 30 etc).
 */
function nextOccurrence(today: Date, dueMonth: number, dueDay: number): string {
  const tryBuild = (year: number, day: number) => {
    const d = new Date(Date.UTC(year, dueMonth - 1, day));
    // Reject day-overflow (e.g. Feb 30 → Mar 2): rebuild clamped to 28.
    if (d.getUTCMonth() !== dueMonth - 1) {
      return new Date(Date.UTC(year, dueMonth - 1, 28));
    }
    return d;
  };
  const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  let candidate = tryBuild(today.getUTCFullYear(), dueDay);
  if (candidate.getTime() < todayUTC.getTime()) {
    candidate = tryBuild(today.getUTCFullYear() + 1, dueDay);
  }
  return candidate.toISOString().slice(0, 10);
}

/**
 * T12 — Idempotent seeder for the standard recurring compliance events of
 * a freshly-incorporated entity. Mirrors
 * `backend/app/api/routes/compliance.py:seed_standard_events_for_jurisdiction`.
 *
 * Called by `legal.ts` `/incorporate/wizard` AFTER the entity row is
 * created. Failures here MUST NOT block incorporation — callers wrap in
 * try/catch and swallow.
 *
 * Idempotent because compliance_events has UNIQUE(project_id, event_type,
 * due_date); the `INSERT OR IGNORE` makes re-runs a no-op.
 *
 * Returns the rows that were actually inserted (not the existing ones —
 * matches the FastAPI behaviour of returning only the freshly-created
 * events).
 */
export async function seedStandardEventsForJurisdiction(
  env: Env,
  opts: {
    projectId: number;
    entityId: number | null;
    jurisdictionId: string;
    jurisdictionLabel: string;
    userId: number | null;
    incorporationDate?: string | null;  // ISO 'YYYY-MM-DD'
  },
): Promise<Array<{ id: number; event_type: string; title: string; due_date: string }>> {
  const catalogue = STANDARD_EVENTS[opts.jurisdictionId];
  if (!catalogue || !catalogue.length) return [];

  const today = opts.incorporationDate
    ? new Date(`${opts.incorporationDate}T00:00:00Z`)
    : new Date();

  const created: Array<{ id: number; event_type: string; title: string; due_date: string }> = [];
  for (const spec of catalogue) {
    // Per-event try/catch — matches FastAPI's partial-success behaviour
    // where one bad spec must NOT abort the rest of the catalogue. Without
    // this, a single failing INSERT would propagate up and the outer
    // try/catch in legal.ts would discard every other event in the run.
    try {
      let due: string;
      if (spec.due_month != null && spec.due_day != null) {
        due = nextOccurrence(today, spec.due_month, spec.due_day);
      } else {
        const offset = spec.offset_days ?? 365;
        const d = new Date(today.getTime() + offset * 86_400_000);
        due = d.toISOString().slice(0, 10);
      }

      // INSERT OR IGNORE so a UNIQUE collision (already seeded) is a no-op.
      const result = await env.DB.prepare(
        `INSERT OR IGNORE INTO compliance_events
           (project_id, entity_id, jurisdiction, event_type, title, description,
            due_date, recurrence, source, created_by_user_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'auto', ?)`,
      ).bind(
        opts.projectId,
        opts.entityId,
        opts.jurisdictionLabel,
        spec.event_type,
        spec.title,
        spec.description ?? null,
        due,
        spec.recurrence,
        opts.userId,
      ).run();

      // Only push to `created` if the INSERT actually wrote a row. D1's
      // `meta.changes` is 1 on insert, 0 on IGNORE.
      if ((result as any)?.meta?.changes >= 1) {
        const row = await env.DB.prepare(
          `SELECT id, event_type, title, due_date FROM compliance_events
            WHERE project_id = ? AND event_type = ? AND due_date = ?`,
        ).bind(opts.projectId, spec.event_type, due).first<{ id: number; event_type: string; title: string; due_date: string }>();
        if (row) created.push(row);
      }
    } catch (e) {
      console.warn(
        `seedStandardEvents: skipped ${spec.event_type} for project=${opts.projectId}:`,
        (e as Error)?.message,
      );
    }
  }
  return created;
}

type EventRow = {
  id: number; uid: string; project_id: number; entity_id: number | null;
  jurisdiction: string; event_type: string; title: string; description: string | null;
  due_date: string;        // 'YYYY-MM-DD'
  completion_status: string;
  completed_at: string | null;
  completed_by_user_id: number | null;
  recurrence: string; source: string;
  reminders_sent_json: string;
  created_by_user_id: number | null;
  created_at: string; updated_at: string;
};

type Project = { id: number; founder_id: number | null; entity_id: number | null };

function role(u: { role: string }): string { return (u.role || '').toLowerCase(); }
function isPrivilegedReader(r: string): boolean { return r === 'admin' || r === 'partner' || r === 'investor'; }
function isPrivilegedWriter(r: string): boolean { return r === 'admin' || r === 'partner'; }

async function loadProject(env: Env, id: number): Promise<Project | null> {
  return env.DB.prepare('SELECT id, founder_id, entity_id FROM projects WHERE id = ?')
    .bind(id).first<Project>();
}

function checkRead(user: { role: string; founder_id?: number | null }, p: Project) {
  if (isPrivilegedReader(role(user))) return;
  if (p.founder_id != null && p.founder_id === user.founder_id) return;
  throw new Error('Forbidden');
}

function checkWrite(user: { role: string; founder_id?: number | null }, p: Project) {
  if (isPrivilegedWriter(role(user))) return;
  if (p.founder_id != null && p.founder_id === user.founder_id) return;
  throw new Error('Forbidden');
}

function daysBetween(today: string, due: string): number {
  // Interpret both as UTC dates so DST doesn't drift the count.
  const a = new Date(`${today}T00:00:00Z`).getTime();
  const b = new Date(`${due}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function todayIso(): string { return new Date().toISOString().slice(0, 10); }

function serialize(e: EventRow): any {
  const today = todayIso();
  return {
    id: e.id,
    uid: e.uid,
    project_id: e.project_id,
    entity_id: e.entity_id,
    jurisdiction: e.jurisdiction,
    event_type: e.event_type,
    title: e.title,
    description: e.description,
    due_date: e.due_date,
    days_until: daysBetween(today, e.due_date),
    completion_status: e.completion_status,
    completed_at: e.completed_at,
    recurrence: e.recurrence,
    source: e.source,
    reminders_sent: (() => {
      try { return JSON.parse(e.reminders_sent_json || '[]'); } catch { return []; }
    })(),
    created_at: e.created_at,
    updated_at: e.updated_at,
  };
}

compliance.get('/events', async (c) => {
  const user = await requireAuth(c);
  const projectId = c.req.query('project_id') ? Number(c.req.query('project_id')) : null;
  const status = c.req.query('status');
  const r = role(user);

  let where = '1=1';
  const params: any[] = [];
  if (projectId != null) {
    if (!Number.isFinite(projectId)) return c.json({ detail: 'project_id must be integer' }, 400);
    const proj = await loadProject(c.env, projectId);
    if (!proj) return c.json({ detail: 'Project not found' }, 404);
    try { checkRead(user, proj); } catch { return c.json({ detail: 'Forbidden' }, 403); }
    where += ' AND project_id = ?';
    params.push(projectId);
  } else if (r === 'admin' || r === 'partner') {
    // Privileged operators see everything.
  } else if (r === 'founder') {
    const own = await c.env.DB.prepare('SELECT id FROM projects WHERE founder_id = ?')
      .bind(user.founder_id ?? -1).all<{ id: number }>();
    const ids = (own.results || []).map((p: any) => p.id);
    if (!ids.length) return c.json({ events: [], summary: { total: 0, overdue: 0, due_30d: 0, due_7d: 0, completed: 0 } });
    where += ` AND project_id IN (${ids.map(() => '?').join(',')})`;
    params.push(...ids);
  } else {
    return c.json({ detail: 'project_id is required for this role' }, 400);
  }
  if (status) {
    where += ' AND completion_status = ?';
    params.push(status);
  }
  const rows = await c.env.DB.prepare(
    `SELECT * FROM compliance_events WHERE ${where} ORDER BY due_date ASC`,
  ).bind(...params).all<EventRow>();
  const events = (rows.results || []) as EventRow[];

  const today = todayIso();
  const summary = { total: events.length, overdue: 0, due_30d: 0, due_7d: 0, completed: 0 };
  for (const e of events) {
    if (e.completion_status === 'completed') { summary.completed++; continue; }
    const d = daysBetween(today, e.due_date);
    if (d < 0) summary.overdue++;
    else if (d <= 7) summary.due_7d++;
    else if (d <= 30) summary.due_30d++;
  }
  return c.json({ events: events.map(serialize), summary });
});

compliance.post('/events', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  const projectId = Number(body?.project_id);
  if (!Number.isFinite(projectId)) return c.json({ detail: 'project_id is required' }, 400);
  const proj = await loadProject(c.env, projectId);
  if (!proj) return c.json({ detail: 'Project not found' }, 404);
  try { checkWrite(user, proj); } catch { return c.json({ detail: 'Forbidden' }, 403); }

  const due = String(body?.due_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return c.json({ detail: 'due_date must be YYYY-MM-DD' }, 400);
  const title = String(body?.title || '').trim();
  if (!title) return c.json({ detail: 'title is required' }, 400);

  let entityId: number | null = null;
  let jurisdiction = String(body?.jurisdiction || '').trim();
  if (proj.entity_id) {
    const ent = await c.env.DB.prepare('SELECT id, jurisdiction FROM entities WHERE id = ?')
      .bind(proj.entity_id).first<{ id: number; jurisdiction: string | null }>();
    if (ent) {
      entityId = ent.id;
      if (!jurisdiction) jurisdiction = ent.jurisdiction || 'Unspecified';
    }
  }
  if (!jurisdiction) jurisdiction = 'Unspecified';
  const eventType = String(body?.event_type || 'other');
  const description = body?.description ?? null;
  const recurrence = String(body?.recurrence || 'annual');

  // Try insert; on UNIQUE(project_id, event_type, due_date) collision return the existing row.
  try {
    await c.env.DB.prepare(
      `INSERT INTO compliance_events
         (project_id, entity_id, jurisdiction, event_type, title, description,
          due_date, recurrence, source, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`,
    ).bind(projectId, entityId, jurisdiction, eventType, title, description, due, recurrence, user.id).run();
  } catch (e: any) {
    // Duplicate — fall through to read existing.
  }
  const row = await c.env.DB.prepare(
    `SELECT * FROM compliance_events
      WHERE project_id = ? AND event_type = ? AND due_date = ?`,
  ).bind(projectId, eventType, due).first<EventRow>();
  if (!row) return c.json({ detail: 'Insert failed' }, 500);
  return c.json(serialize(row));
});

compliance.patch('/events/:id', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'invalid id' }, 400);
  const event = await c.env.DB.prepare('SELECT * FROM compliance_events WHERE id = ?')
    .bind(id).first<EventRow>();
  if (!event) return c.json({ detail: 'Event not found' }, 404);
  const proj = await loadProject(c.env, event.project_id);
  if (!proj) return c.json({ detail: 'Project not found' }, 404);
  try { checkWrite(user, proj); } catch { return c.json({ detail: 'Forbidden' }, 403); }

  const body = await c.req.json().catch(() => ({}));
  const updates: string[] = [];
  const params: any[] = [];
  let newStatus: string | null = null;
  // Roll-forward of recurring events always uses the ORIGINAL due_date
  // (matches FastAPI behaviour where the next occurrence is computed
  // before any due_date mutation in the same PATCH).
  const rollForwardBaseIso = event.due_date;

  if (body?.completion_status !== undefined) {
    const s = String(body.completion_status);
    if (!['pending', 'completed', 'snoozed'].includes(s)) {
      return c.json({ detail: 'invalid completion_status' }, 400);
    }
    newStatus = s;
    updates.push('completion_status = ?');
    params.push(s);
    if (s === 'completed') {
      updates.push('completed_at = ?', 'completed_by_user_id = ?');
      params.push(new Date().toISOString(), user.id);
    } else {
      updates.push('completed_at = NULL', 'completed_by_user_id = NULL');
    }
  }
  if (body?.title !== undefined) {
    const t = String(body.title || '').trim();
    if (t) { updates.push('title = ?'); params.push(t); }
  }
  if (body?.description !== undefined) {
    updates.push('description = ?');
    params.push(body.description);
  }
  if (body?.due_date !== undefined) {
    const d = String(body.due_date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return c.json({ detail: 'due_date must be YYYY-MM-DD' }, 400);
    updates.push('due_date = ?', 'reminders_sent_json = ?');
    params.push(d, '[]');
  }

  if (updates.length === 0) return c.json(serialize(event));
  updates.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);
  await c.env.DB.prepare(
    `UPDATE compliance_events SET ${updates.join(', ')} WHERE id = ?`,
  ).bind(...params).run();

  // Auto-roll the next occurrence forward for recurring events when
  // this one was just marked completed (matches FastAPI behaviour).
  if (newStatus === 'completed' && event.recurrence !== 'one_time') {
    const deltaDays = ({ annual: 365, quarterly: 91, monthly: 30 } as Record<string, number>)[event.recurrence] || 365;
    const nextDue = new Date(`${rollForwardBaseIso}T00:00:00Z`).getTime() + deltaDays * 86_400_000;
    const nextIso = new Date(nextDue).toISOString().slice(0, 10);
    try {
      await c.env.DB.prepare(
        `INSERT INTO compliance_events
           (project_id, entity_id, jurisdiction, event_type, title, description,
            due_date, recurrence, source, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        event.project_id, event.entity_id, event.jurisdiction, event.event_type,
        event.title, event.description, nextIso, event.recurrence, event.source,
        event.created_by_user_id ?? user.id,
      ).run();
    } catch {
      // Already seeded for next year — ignore the UNIQUE collision.
    }
  }

  const fresh = await c.env.DB.prepare('SELECT * FROM compliance_events WHERE id = ?')
    .bind(id).first<EventRow>();
  return c.json(serialize(fresh as EventRow));
});

compliance.delete('/events/:id', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'invalid id' }, 400);
  const event = await c.env.DB.prepare('SELECT * FROM compliance_events WHERE id = ?')
    .bind(id).first<EventRow>();
  if (!event) return c.json({ detail: 'Event not found' }, 404);
  const proj = await loadProject(c.env, event.project_id);
  if (!proj) return c.json({ detail: 'Project not found' }, 404);
  try { checkWrite(user, proj); } catch { return c.json({ detail: 'Forbidden' }, 403); }
  await c.env.DB.prepare('DELETE FROM compliance_events WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

export default compliance;
