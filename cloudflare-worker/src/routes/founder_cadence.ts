/**
 * The operating cadence: the rituals a venture runs, what came out of each one,
 * and the templates they are conducted from.
 *
 * WHAT THIS REPLACES. `/build/cadence` printed "Cadence store unavailable" in
 * four places and registered all four of its filter chips and all three of its
 * ops as `unbuilt`, which renders nothing — so the zone shipped with an empty
 * toolbar and a page that explained, at length, that it had no source. Migration
 * 250 gives it one. Task #176, FB4.
 *
 * THE COUNTS ARE COMPUTED HERE AND STORED NOWHERE. Reviews archived, adherence,
 * the template count and the average retro length are all counts over
 * `ritual_runs` and `ritual_templates`. `founder_validate.ts` states the rule
 * this follows: a stored count is a second answer to a question the rows already
 * answer, and the two disagree the first time a row is edited.
 *
 * ADHERENCE IS `done / (done + missed)` AND THAT NEEDS THE MISSED ROWS TO EXIST.
 * A ritual that was skipped and never recorded is invisible to this figure, so
 * adherence over a project that logs only its successes reads 100%. That is not
 * a bug to paper over with an inferred miss — inferring one would mean deciding
 * that a ritual scheduled for a date it has no row on did not happen, and a
 * founder on holiday has not broken their cadence. The route reports the
 * denominator alongside the percentage so the figure cannot be read as more than
 * it is, and `runs_recorded` is what the page shows when there are none.
 *
 * THE FILTER ROW MIXES TWO AXES, WHICH IS THE CANVAS'S CHOICE AND NOT AN ERROR.
 * `All rituals · Plans · Retros · Skipped` — the first three select on the
 * ritual's KIND, the fourth on the run's STATE. So `Skipped` and `Retros`
 * overlap: a missed retro is in both. The predicate lives in the page (each
 * zone's does), and `cadenceViews` below is the shared vocabulary both halves
 * read, so the server's CSV export and the client's chips cannot disagree about
 * what `retros` means.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { ensureCadenceSchema } from '../services/cadenceSchema';
import { canReadBoard, canWrite, type ProjectRef } from './_founder_validate_helpers';

const founderCadence = new Hono<{ Bindings: Env }>();

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
const forbidden = () => json({ detail: 'Forbidden' }, 403);
const notFound = (what: string) => json({ detail: `${what} not found` }, 404);

/**
 * The four ritual kinds. `other` is the escape, and it is load-bearing: without
 * it a founder's weekly investor sync has to claim to be a retro to be stored
 * at all, and then it lands in the `Retros` filter and in the average retro
 * length. A store that forces a wrong answer gets wrong answers.
 */
export const RITUAL_KINDS = ['plan', 'standup', 'retro', 'other'] as const;
export const RITUAL_FREQUENCIES = ['weekly', 'biweekly', 'monthly'] as const;
/** Two states, and a run that has not happened is ABSENT rather than a third. */
export const RUN_STATES = ['done', 'missed'] as const;

/**
 * Which ritual kinds each zone filter selects, and whether it narrows on state.
 *
 * Exported because both the page's chips and this file's CSV export read it.
 * `kinds: null` means every kind.
 */
export const CADENCE_VIEWS: Record<string, { kinds: readonly string[] | null; state: string | null }> = {
  all: { kinds: null, state: null },
  plans: { kinds: ['plan'], state: null },
  retros: { kinds: ['retro'], state: null },
  skipped: { kinds: null, state: 'missed' },
};

const trimOrNull = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};

/**
 * A whole number, or null — and emptiness is checked BEFORE `Number()`.
 *
 * `Number(null)` and `Number('')` are both 0 and both `Number.isFinite`, so a
 * blank `duration_minutes` coerced first arrives as a real zero and drags the
 * average retro length down with it. #203 shipped that bug in the function whose
 * docblock forbade it; the order here is the fix, not a preference.
 */
function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** `YYYY-MM-DD`, or null. Text that sorts in date order; never `Date.parse`. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function dayOrNull(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return ISO_DAY.test(s) ? s : null;
}

type ProjectRow = ProjectRef & { name: string };

async function loadProject(env: Env, projectId: number): Promise<ProjectRow | null> {
  return env.DB.prepare('SELECT id, name, founder_id FROM projects WHERE id = ?')
    .bind(projectId).first<ProjectRow>();
}

/** Resolve the project and the caller, or the Response that refuses them. */
async function scope(
  c: any, projectId: number, gate: (p: ProjectRef, u: User) => boolean,
): Promise<{ user: User; project: ProjectRow } | Response> {
  if (!Number.isFinite(projectId)) return json({ detail: 'Invalid project id' }, 400);
  const user = (await requireAuth(c)) as User;
  const project = await loadProject(c.env, projectId);
  if (!project) return notFound('Project');
  if (!gate(project, user)) return forbidden();
  return { user, project };
}

/**
 * Resolve a ritual, run or template to the project that owns it, then gate.
 *
 * Every write below addresses its row by id alone, which is what the SPA has —
 * so the project comes from the ROW and the caller is checked against that,
 * never against a project id in the request. A gate over a caller-supplied
 * project id is the IDOR this indirection exists to refuse.
 */
async function scopeChild(
  c: any, table: 'project_rituals' | 'ritual_runs' | 'ritual_templates', id: number,
): Promise<{ user: User; project: ProjectRow } | Response> {
  if (!Number.isFinite(id)) return json({ detail: 'Invalid id' }, 400);
  // The table name is one of three literals chosen by the caller in this file,
  // never from a request — `check-sql-prepare.mjs` allows the switch, and a
  // template string over a request value would be the thing it exists to catch.
  const sql = table === 'project_rituals'
    ? 'SELECT project_id FROM project_rituals WHERE id = ?'
    : table === 'ritual_runs'
      ? 'SELECT project_id FROM ritual_runs WHERE id = ?'
      : 'SELECT project_id FROM ritual_templates WHERE id = ?';
  // `(c.env as Env).DB` rather than `c.env.DB`: `c` is `any` here (the Hono
  // context shape this file shares with `founder_validate.ts`), and a type
  // argument on a call through `any` is TS2347 — "untyped function calls may not
  // accept type arguments". Naming the binding's type restores the generic.
  const row = await (c.env as Env).DB.prepare(sql).bind(id).first<{ project_id: number }>();
  if (!row) return notFound('Record');
  return scope(c, Number(row.project_id), canWrite);
}

type RitualRow = {
  id: number;
  project_id: number;
  name: string;
  kind: string;
  frequency: string;
  weekday: number | null;
  target_minutes: number | null;
  template_id: number | null;
  active: number;
  created_at: string | null;
};

type RunRow = {
  id: number;
  ritual_id: number;
  run_date: string;
  state: string;
  outcome: string | null;
  duration_minutes: number | null;
  notes: string | null;
  ritual_name: string | null;
  ritual_kind: string | null;
};

type TemplateRow = {
  id: number;
  name: string;
  kind: string;
  body: string;
  based_on: string | null;
  edited_at: string | null;
  created_at: string | null;
};

/** The archive, newest first, with the ritual each run belongs to. */
const ARCHIVE_SQL =
  'SELECT r.id, r.ritual_id, r.run_date, r.state, r.outcome, r.duration_minutes, r.notes,'
  + ' t.name AS ritual_name, t.kind AS ritual_kind'
  + ' FROM ritual_runs r LEFT JOIN project_rituals t ON t.id = r.ritual_id'
  + ' WHERE r.project_id = ?'
  + ' ORDER BY r.run_date DESC, r.id DESC LIMIT 500';

/**
 * The built-in starting points a founder can create a template FROM.
 *
 * Not rows. Nothing is seeded into `ritual_templates` on read, because a GET
 * that writes is a GET that cannot be retried safely and a seeded row is
 * indistinguishable from one the founder wrote. These are offered by the page as
 * starting text; the row that results carries `based_on` naming which one, so
 * "1 customised" can be said later without a stored flag.
 */
export const TEMPLATE_STARTERS: readonly { slug: string; name: string; kind: string; body: string }[] = [
  {
    slug: 'weekly-plan', name: 'Monday plan', kind: 'plan',
    body: 'What are the three things that must be true by Friday?\n'
      + 'What carried in from last week, and why?\n'
      + 'What are we NOT doing this week?',
  },
  {
    slug: 'standup', name: 'Standup', kind: 'standup',
    body: 'What moved since we last met?\n'
      + 'What is blocked, and on whom?\n'
      + 'Anything that changes the week’s three?',
  },
  {
    slug: 'retro', name: 'Friday retro', kind: 'retro',
    body: 'Which commitments landed, and which carried again?\n'
      + 'What did we learn that changes how we work?\n'
      + 'One decision to take now, written down so next week can check it.',
  },
];

/**
 * REGISTERED BEFORE `/:projectId`, AND A TEST FOUND OUT WHY.
 *
 * Hono matches in registration order, so with the parameterised GET first this
 * path resolved as `projectId = 'starters'`, `Number('starters')` was NaN, and
 * the route answered 400 "Invalid project id" — a literal route silently
 * swallowed by a sibling pattern, with nothing in either handler to suggest it.
 * A static segment goes above the parameter that would otherwise eat it.
 */
founderCadence.get('/starters', (c) => json({ starters: TEMPLATE_STARTERS }));

/**
 * The whole zone in one call: the schedule, the archive, the templates and the
 * four figures above them.
 *
 * ONE CALL AND NOT FIVE because every one of the four stat cards is a count over
 * rows this response already carries, and computing them in SQL as well would be
 * two answers again. The `LIMIT 500` on the archive is the one place that could
 * make them disagree, so the counts come from their own aggregates rather than
 * from the returned page of rows — a project with 600 reviews reports 600 and
 * shows the newest 500.
 */
founderCadence.get('/:projectId', async (c) => {
  const projectId = Number(c.req.param('projectId'));
  const got = await scope(c, projectId, canReadBoard);
  if (got instanceof Response) return got;

  const ready = await ensureCadenceSchema(c.env);
  if (!ready) {
    return json({
      project_id: projectId, store_ready: false,
      rituals: [], runs: [], templates: [],
      stats: { runs_recorded: 0, done: 0, missed: 0, adherence_pct: null, templates: 0, templates_customised: 0, avg_retro_minutes: null, retro_target_minutes: null },
    });
  }

  const [rituals, runs, templates, tally, retro, target] = await Promise.all([
    c.env.DB.prepare(
      'SELECT id, project_id, name, kind, frequency, weekday, target_minutes, template_id, active, created_at'
      + ' FROM project_rituals WHERE project_id = ? ORDER BY active DESC, weekday ASC, name ASC',
    ).bind(projectId).all<RitualRow>().then((r) => r.results || []).catch(() => [] as RitualRow[]),
    c.env.DB.prepare(ARCHIVE_SQL).bind(projectId).all<RunRow>()
      .then((r) => r.results || []).catch(() => [] as RunRow[]),
    c.env.DB.prepare(
      'SELECT id, name, kind, body, based_on, edited_at, created_at'
      + ' FROM ritual_templates WHERE project_id = ? ORDER BY name ASC',
    ).bind(projectId).all<TemplateRow>().then((r) => r.results || []).catch(() => [] as TemplateRow[]),
    // The aggregates, over EVERY run rather than the returned page.
    c.env.DB.prepare(
      "SELECT COUNT(*) AS n,"
      + " SUM(CASE WHEN state = 'done' THEN 1 ELSE 0 END) AS done,"
      + " SUM(CASE WHEN state = 'missed' THEN 1 ELSE 0 END) AS missed"
      + ' FROM ritual_runs WHERE project_id = ?',
    ).bind(projectId).first<{ n: number; done: number | null; missed: number | null }>()
      .catch(() => null),
    // Average retro length over runs that RECORDED one.
    //
    // `IS NOT NULL` IS REDUNDANT WITH SQL'S OWN AVG, which skips NULLs — kept
    // because the clause states the intent at the point a reader asks about it,
    // and verified against `node:sqlite` rather than assumed. What actually
    // protects this figure from the `Number(null) === 0` trap is `intOrNull` on
    // the way IN; a blank never reaches the column as a zero.
    c.env.DB.prepare(
      'SELECT AVG(r.duration_minutes) AS avg_minutes'
      + ' FROM ritual_runs r JOIN project_rituals t ON t.id = r.ritual_id'
      + " WHERE r.project_id = ? AND t.kind = 'retro' AND r.state = 'done'"
      + ' AND r.duration_minutes IS NOT NULL',
    ).bind(projectId).first<{ avg_minutes: number | null }>()
      .catch(() => null),
    // THE TARGET IS ITS OWN QUERY, and a mutation sweep is what showed why.
    // Reading it from the average's row set meant a retro ritual whose runs were
    // all untimed contributed no target at all — so a founder who had set
    // "target 30" and never timed a retro saw "No target set". The target is a
    // property of the RITUAL; the average is a property of its timed runs. Two
    // questions, two queries.
    c.env.DB.prepare(
      "SELECT MAX(target_minutes) AS target_minutes FROM project_rituals"
      + " WHERE project_id = ? AND kind = 'retro'",
    ).bind(projectId).first<{ target_minutes: number | null }>()
      .catch(() => null),
  ]);

  const done = Number(tally?.done ?? 0);
  const missed = Number(tally?.missed ?? 0);
  const decided = done + missed;
  const avg = retro?.avg_minutes;

  return json({
    project_id: projectId,
    project_name: got.project.name,
    store_ready: true,
    rituals,
    runs,
    templates,
    stats: {
      runs_recorded: Number(tally?.n ?? 0),
      done,
      missed,
      // NULL, not 0, with nothing recorded — "0% adherence" over an empty
      // archive is a claim about a founder who has simply not logged anything.
      adherence_pct: decided > 0 ? Math.round((done / decided) * 100) : null,
      templates: templates.length,
      templates_customised: templates.filter((t) => t.edited_at != null).length,
      avg_retro_minutes: typeof avg === 'number' && Number.isFinite(avg) ? Math.round(avg) : null,
      retro_target_minutes: target?.target_minutes ?? null,
    },
  });
});

// ── The schedule ─────────────────────────────────────────────────────────────

founderCadence.post('/:projectId/rituals', async (c) => {
  const projectId = Number(c.req.param('projectId'));
  const got = await scope(c, projectId, canWrite);
  if (got instanceof Response) return got;
  if (!(await ensureCadenceSchema(c.env))) return json({ detail: 'Cadence store unavailable' }, 503);

  const body = await c.req.json().catch(() => ({} as any));
  const name = trimOrNull(body?.name);
  if (!name) return json({ detail: 'A ritual needs a name' }, 400);
  const kind = RITUAL_KINDS.includes(String(body?.kind) as any) ? String(body.kind) : 'other';
  const frequency = RITUAL_FREQUENCIES.includes(String(body?.frequency) as any)
    ? String(body.frequency) : 'weekly';
  const weekdayRaw = intOrNull(body?.weekday);
  // 0–6 or nothing. An out-of-range weekday stored would draw a ritual on a day
  // that does not exist; refusing it is cheaper than rendering around it.
  const weekday = weekdayRaw != null && weekdayRaw >= 0 && weekdayRaw <= 6 ? weekdayRaw : null;

  const res = await c.env.DB.prepare(
    'INSERT INTO project_rituals (project_id, name, kind, frequency, weekday, target_minutes, template_id, created_by)'
    + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    projectId, name, kind, frequency, weekday,
    intOrNull(body?.target_minutes), intOrNull(body?.template_id), got.user.id ?? null,
  ).run();

  return json({ id: res.meta?.last_row_id ?? null, name, kind, frequency, weekday }, 201);
});

founderCadence.put('/rituals/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const got = await scopeChild(c, 'project_rituals', id);
  if (got instanceof Response) return got;

  const body = await c.req.json().catch(() => ({} as any));
  const name = trimOrNull(body?.name);
  const kind = RITUAL_KINDS.includes(String(body?.kind) as any) ? String(body.kind) : null;
  const frequency = RITUAL_FREQUENCIES.includes(String(body?.frequency) as any)
    ? String(body.frequency) : null;
  const weekdayRaw = intOrNull(body?.weekday);
  const weekday = weekdayRaw != null && weekdayRaw >= 0 && weekdayRaw <= 6 ? weekdayRaw : null;
  // `active` is a tri-state on the wire: true, false, or absent. A ritual is
  // retired by setting it false, and its runs stay — the archive is the zone's
  // reason to exist, so deactivating must never cascade.
  const active = body?.active === undefined || body?.active === null
    ? null : (body.active ? 1 : 0);

  // COALESCE rather than a built-up SET list: every field is optional, and a
  // string-concatenated UPDATE is how a partial edit starts nulling columns
  // nobody sent. `?` twice per column, the second as the existing value.
  await c.env.DB.prepare(
    'UPDATE project_rituals SET'
    + ' name = COALESCE(?, name),'
    + ' kind = COALESCE(?, kind),'
    + ' frequency = COALESCE(?, frequency),'
    + ' weekday = COALESCE(?, weekday),'
    + ' target_minutes = COALESCE(?, target_minutes),'
    + ' template_id = COALESCE(?, template_id),'
    + ' active = COALESCE(?, active),'
    + " updated_at = datetime('now')"
    + ' WHERE id = ?',
  ).bind(
    name, kind, frequency, weekday,
    intOrNull(body?.target_minutes), intOrNull(body?.template_id), active, id,
  ).run();

  return json({ id, updated: true });
});

founderCadence.delete('/rituals/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const got = await scopeChild(c, 'project_rituals', id);
  if (got instanceof Response) return got;
  // The runs go with it, because a run with no ritual has no name and no kind —
  // it would appear in the archive as a blank row and in no filter. A founder
  // who wants the history kept retires the ritual (`active = 0`) instead, which
  // is why that path exists and is the one the page offers first.
  await c.env.DB.prepare('DELETE FROM ritual_runs WHERE ritual_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM project_rituals WHERE id = ?').bind(id).run();
  return json({ id, deleted: true });
});

// ── What happened ────────────────────────────────────────────────────────────

founderCadence.post('/:projectId/runs', async (c) => {
  const projectId = Number(c.req.param('projectId'));
  const got = await scope(c, projectId, canWrite);
  if (got instanceof Response) return got;
  if (!(await ensureCadenceSchema(c.env))) return json({ detail: 'Cadence store unavailable' }, 503);

  const body = await c.req.json().catch(() => ({} as any));
  const ritualId = intOrNull(body?.ritual_id);
  if (ritualId == null) return json({ detail: 'A run belongs to a ritual' }, 400);
  const runDate = dayOrNull(body?.run_date);
  if (!runDate) return json({ detail: 'run_date must be YYYY-MM-DD' }, 400);
  const state = RUN_STATES.includes(String(body?.state) as any) ? String(body.state) : 'done';

  // The ritual must be THIS project's. Without this check a founder could file a
  // run against another venture's ritual by id and it would appear in that
  // venture's archive — the row carries `project_id` from the request, so the
  // link is the thing that has to be verified.
  const owns = await c.env.DB.prepare(
    'SELECT id FROM project_rituals WHERE id = ? AND project_id = ?',
  ).bind(ritualId, projectId).first<{ id: number }>();
  if (!owns) return notFound('Ritual');

  // ON CONFLICT rather than a DELETE-then-INSERT: one run per ritual per date
  // (migration 250's unique index), and re-filing Friday's retro updates it
  // instead of leaving a window where the day has no row at all. Same shape as
  // the Stripe upsert #203 replaced.
  const res = await c.env.DB.prepare(
    'INSERT INTO ritual_runs (project_id, ritual_id, run_date, state, outcome, duration_minutes, notes, created_by)'
    + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    + ' ON CONFLICT(ritual_id, run_date) DO UPDATE SET'
    + ' state = excluded.state, outcome = excluded.outcome,'
    + ' duration_minutes = excluded.duration_minutes, notes = excluded.notes,'
    + " updated_at = datetime('now')",
  ).bind(
    projectId, ritualId, runDate, state,
    trimOrNull(body?.outcome), intOrNull(body?.duration_minutes), trimOrNull(body?.notes),
    got.user.id ?? null,
  ).run();

  return json({ id: res.meta?.last_row_id ?? null, ritual_id: ritualId, run_date: runDate, state }, 201);
});

founderCadence.put('/runs/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const got = await scopeChild(c, 'ritual_runs', id);
  if (got instanceof Response) return got;

  const body = await c.req.json().catch(() => ({} as any));
  const state = RUN_STATES.includes(String(body?.state) as any) ? String(body.state) : null;

  await c.env.DB.prepare(
    'UPDATE ritual_runs SET'
    + ' state = COALESCE(?, state),'
    + ' outcome = COALESCE(?, outcome),'
    + ' duration_minutes = COALESCE(?, duration_minutes),'
    + ' notes = COALESCE(?, notes),'
    + " updated_at = datetime('now')"
    + ' WHERE id = ?',
  ).bind(
    state, trimOrNull(body?.outcome), intOrNull(body?.duration_minutes),
    trimOrNull(body?.notes), id,
  ).run();

  return json({ id, updated: true });
});

founderCadence.delete('/runs/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const got = await scopeChild(c, 'ritual_runs', id);
  if (got instanceof Response) return got;
  await c.env.DB.prepare('DELETE FROM ritual_runs WHERE id = ?').bind(id).run();
  return json({ id, deleted: true });
});

// ── The templates ────────────────────────────────────────────────────────────

founderCadence.post('/:projectId/templates', async (c) => {
  const projectId = Number(c.req.param('projectId'));
  const got = await scope(c, projectId, canWrite);
  if (got instanceof Response) return got;
  if (!(await ensureCadenceSchema(c.env))) return json({ detail: 'Cadence store unavailable' }, 503);

  const body = await c.req.json().catch(() => ({} as any));
  const name = trimOrNull(body?.name);
  const text = trimOrNull(body?.body);
  if (!name) return json({ detail: 'A template needs a name' }, 400);
  if (!text) return json({ detail: 'A template needs a body' }, 400);
  const kind = RITUAL_KINDS.includes(String(body?.kind) as any) ? String(body.kind) : 'other';
  // `based_on` is accepted only when it names a starter that exists. A free
  // string here would make the "customised" count unreadable — it is the
  // difference between "derived from the retro starter" and "someone typed
  // something".
  const slug = trimOrNull(body?.based_on);
  const basedOn = slug && TEMPLATE_STARTERS.some((s) => s.slug === slug) ? slug : null;

  const res = await c.env.DB.prepare(
    'INSERT INTO ritual_templates (project_id, name, kind, body, based_on, created_by)'
    + ' VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(projectId, name, kind, text, basedOn, got.user.id ?? null).run();

  return json({ id: res.meta?.last_row_id ?? null, name, kind, based_on: basedOn }, 201);
});

founderCadence.put('/templates/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const got = await scopeChild(c, 'ritual_templates', id);
  if (got instanceof Response) return got;

  const body = await c.req.json().catch(() => ({} as any));
  const name = trimOrNull(body?.name);
  const text = trimOrNull(body?.body);
  const kind = RITUAL_KINDS.includes(String(body?.kind) as any) ? String(body.kind) : null;
  if (!name && !text && !kind) return json({ detail: 'Nothing to change' }, 400);

  // `edited_at` is stamped on ANY save, which is what makes "1 customised"
  // countable without storing the derivation. A save that changes nothing still
  // stamps it: someone opened the template and pressed save, and the alternative
  // is comparing bodies here and calling a whitespace change no edit.
  await c.env.DB.prepare(
    'UPDATE ritual_templates SET'
    + ' name = COALESCE(?, name),'
    + ' kind = COALESCE(?, kind),'
    + ' body = COALESCE(?, body),'
    + " edited_at = datetime('now')"
    + ' WHERE id = ?',
  ).bind(name, kind, text, id).run();

  return json({ id, updated: true });
});

founderCadence.delete('/templates/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const got = await scopeChild(c, 'ritual_templates', id);
  if (got instanceof Response) return got;
  // The rituals that pointed at it keep running. `template_id` is cleared rather
  // than left dangling, so a ritual never claims a prompt that is gone.
  await c.env.DB.prepare('UPDATE project_rituals SET template_id = NULL WHERE template_id = ?')
    .bind(id).run();
  await c.env.DB.prepare('DELETE FROM ritual_templates WHERE id = ?').bind(id).run();
  return json({ id, deleted: true });
});

export default founderCadence;
