/**
 * The hypothesis board and the validation summary, over evidence that already
 * exists.
 *
 * WHAT THIS READS AND WHAT IT DOES NOT TOUCH. Hypotheses have lived in
 * `discovery_interviews.hypotheses_json` all along, and two shipped surfaces
 * read them — `signalsSlider` in `progress.ts` and the demo-day deck builder.
 * Nothing here migrates, rewrites, or supersedes that column. Migration 211's
 * `hypotheses` table is the PROJECT-LEVEL claim those per-interview sentences
 * roll up to, exactly as `pain_groups` is the project-level theme that
 * `pains_json` strings roll up to. One sentence, one home.
 *
 * THE COUNTS ARE COMPUTED HERE AND STORED NOWHERE. Verdict, lane, For, Against
 * and the distance to the bar are all derived at read time from the interviews
 * plus the links. Storing any of them would be a second answer to a question
 * the interviews already answer, and the two disagree the first time an
 * interview is edited.
 *
 * TWO ACCESS RULES, DELIBERATELY DIFFERENT. The board and summary are derived
 * from interviews and are read by whoever may read the interviews — admins and
 * partners included. The founder's proceed/pivot/stop decision is not derived
 * from anything, and partners are excluded from it. Both predicates live in
 * `_founder_validate_helpers.ts` with the tests that hold them apart.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { loadPainGroupModel, normPhrase } from '../services/painGroups';
import { ensureDiscoveryEvidenceColumns } from '../services/discoveryInterviewSchema';
import {
  canReadBoard, canReadDecision, canWrite,
  verdictFor, laneFor, barNoteFor, evidenceFor, isIcp, VALIDATION_BAR,
  type ProjectRef,
} from './_founder_validate_helpers';

const founderValidate = new Hono<{ Bindings: Env }>();

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
const forbidden = () => json({ detail: 'Forbidden' }, 403);
const notFound = (what: string) => json({ detail: `${what} not found` }, 404);

const trimOrNull = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};

/** ICP fit values the product recognises. NULL is a fourth state, not a value. */
const ICP_VALUES = new Set(['strong', 'partial', 'none']);
const DIRECTIONS = new Set(['supports', 'contradicts']);
const DECISIONS = new Set(['proceed', 'pivot', 'stop']);

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

type InterviewRow = {
  id: number;
  interviewee_name: string | null;
  interviewee_role: string | null;
  interviewee_company: string | null;
  icp_fit: string | null;
  quote_consent: number | null;
  pains_json: string | null;
};

/**
 * Every interview on the project, with the pain groups it touched.
 *
 * The phrase→group hop goes through `pain_group_aliases` because that is where
 * the founder's own curation lives; matching raw strings would re-cluster the
 * pains differently from the pain map next door and give two pages two
 * different answers about the same interviews.
 */
async function loadEvidenceBase(env: Env, projectId: number) {
  const model = await loadPainGroupModel(env, projectId);
  // The SELECT below names migration 211's columns. On an environment where
  // 211 has not run, `.catch(() => [])` would turn "no such column" into "no
  // interviews" and the board would read as empty rather than broken — so the
  // columns are ensured first, the same way the interview CRUD ensures them.
  await ensureDiscoveryEvidenceColumns(env);
  const res = await env.DB.prepare(
    `SELECT id, interviewee_name, interviewee_role, interviewee_company,
            icp_fit, quote_consent, pains_json
       FROM discovery_interviews WHERE project_id = ? ORDER BY id`,
  ).bind(projectId).all<InterviewRow>().catch(() => ({ results: [] as InterviewRow[] }));

  const interviews = (res.results || []).map((r) => {
    let pains: unknown[] = [];
    try {
      const parsed = JSON.parse(r.pains_json || '[]');
      if (Array.isArray(parsed)) pains = parsed;
    } catch { /* a malformed blob is no pains, not a crash */ }
    const groups = new Set<number>();
    for (const p of pains) {
      const gid = model.aliasByNorm.get(normPhrase(typeof p === 'string' ? p : String((p as any)?.pain ?? '')));
      if (gid) groups.add(gid);
    }
    return { row: r, groups, icp_fit: r.icp_fit };
  });
  return { interviews, model };
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

founderValidate.get('/board/:projectId', async (c) => {
  const s = await scope(c, Number(c.req.param('projectId')), canReadBoard);
  if (s instanceof Response) return s;

  const hyps = await c.env.DB.prepare(
    `SELECT id, code, claim, sort_order, retired_at
       FROM hypotheses WHERE project_id = ? ORDER BY sort_order, id`,
  ).bind(s.project.id).all<any>().catch(() => ({ results: [] as any[] }));

  const linkRes = await c.env.DB.prepare(
    `SELECT l.id, l.hypothesis_id, l.pain_group_id, l.direction
       FROM hypothesis_pain_links l
       JOIN hypotheses h ON h.id = l.hypothesis_id
      WHERE h.project_id = ?`,
  ).bind(s.project.id).all<any>().catch(() => ({ results: [] as any[] }));

  const { interviews, model } = await loadEvidenceBase(c.env, s.project.id);
  const linksBy = new Map<number, any[]>();
  for (const l of linkRes.results || []) {
    if (!linksBy.has(l.hypothesis_id)) linksBy.set(l.hypothesis_id, []);
    linksBy.get(l.hypothesis_id)!.push(l);
  }

  const items = (hyps.results || []).map((h) => {
    const links = linksBy.get(h.id) || [];
    const evidence = evidenceFor(links, interviews);
    const verdict = verdictFor(evidence);
    return {
      ...h,
      links,
      evidence,
      verdict,
      lane: laneFor(verdict, evidence),
      bar_note: barNoteFor(evidence),
      // The page must be able to say WHY a verdict is missing rather than
      // rendering a blank cell that looks like a loading state.
      _note: verdict === null
        ? `${evidence.fitUnrecorded} interview(s) touching this claim have no ICP fit recorded, so a verdict would be a guess`
        : null,
    };
  });

  // Project-level honesty: how much of the evidence base is unusable, and why.
  const fitMissing = interviews.filter((i) => i.row.icp_fit == null).length;
  const consentMissing = interviews.filter((i) => i.row.quote_consent == null).length;

  return json({
    project: { id: s.project.id, name: s.project.name },
    bar: VALIDATION_BAR,
    hypotheses: items,
    pain_groups: model.groups,
    evidence_base: {
      interviews: interviews.length,
      icp: interviews.filter((i) => isIcp(i.row.icp_fit)).length,
      fit_not_recorded: fitMissing,
      quotable: interviews.filter((i) => i.row.quote_consent === 1).length,
      consent_not_recorded: consentMissing,
    },
  });
});

founderValidate.post('/board/:projectId/hypotheses', async (c) => {
  const s = await scope(c, Number(c.req.param('projectId')), canWrite);
  if (s instanceof Response) return s;
  const b = await c.req.json().catch(() => ({} as any));
  const claim = trimOrNull(b.claim);
  if (!claim) return json({ detail: 'A hypothesis needs a claim' }, 400);

  // `code` is what a person reads and repeats, so it is allocated from the
  // highest ever used rather than the current count — retiring H2 must not
  // hand "H2" to a different claim later.
  const max = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(CAST(substr(code, 2) AS INTEGER)), 0) AS n FROM hypotheses WHERE project_id = ? AND code GLOB 'H*'",
  ).bind(s.project.id).first<{ n: number }>();
  const code = `H${Number(max?.n || 0) + 1}`;

  const r = await c.env.DB.prepare(
    `INSERT INTO hypotheses (project_id, code, claim, sort_order)
     VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM hypotheses WHERE project_id = ?))`,
  ).bind(s.project.id, code, claim, s.project.id).run();
  return json({ id: r.meta?.last_row_id, code, claim }, 201);
});

founderValidate.patch('/hypotheses/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const owner = await c.env.DB.prepare(
    'SELECT project_id FROM hypotheses WHERE id = ?',
  ).bind(id).first<{ project_id: number }>();
  if (!owner) return notFound('Hypothesis');
  const s = await scope(c, Number(owner.project_id), canWrite);
  if (s instanceof Response) return s;

  const b = await c.req.json().catch(() => ({} as any));
  const claim = trimOrNull(b.claim);
  // Retire and un-retire, never delete: an abandoned hypothesis is evidence
  // about how the venture thought, and the canvas draws a "Retired" filter.
  const retire = b.retired === true ? new Date().toISOString()
    : b.retired === false ? null : undefined;
  if (claim === null && retire === undefined) return json({ detail: 'Nothing to change' }, 400);

  if (claim !== null) {
    await c.env.DB.prepare(
      "UPDATE hypotheses SET claim = ?, updated_at = datetime('now') WHERE id = ?",
    ).bind(claim, id).run();
  }
  if (retire !== undefined) {
    await c.env.DB.prepare(
      "UPDATE hypotheses SET retired_at = ?, updated_at = datetime('now') WHERE id = ?",
    ).bind(retire, id).run();
  }
  return json({ ok: true });
});

founderValidate.post('/hypotheses/:id/links', async (c) => {
  const id = Number(c.req.param('id'));
  const owner = await c.env.DB.prepare(
    'SELECT project_id FROM hypotheses WHERE id = ?',
  ).bind(id).first<{ project_id: number }>();
  if (!owner) return notFound('Hypothesis');
  const s = await scope(c, Number(owner.project_id), canWrite);
  if (s instanceof Response) return s;

  const b = await c.req.json().catch(() => ({} as any));
  const direction = String(b.direction || '');
  const groupId = Number(b.pain_group_id);
  if (!DIRECTIONS.has(direction)) return json({ detail: 'direction must be supports or contradicts' }, 400);

  // The pain group must belong to the SAME project. Without this a link could
  // pull another venture's interviews into this venture's evidence count.
  const group = await c.env.DB.prepare(
    'SELECT id FROM pain_groups WHERE id = ? AND project_id = ?',
  ).bind(groupId, owner.project_id).first<{ id: number }>();
  if (!group) return notFound('Pain group');

  await c.env.DB.prepare(
    `INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction)
     VALUES (?, ?, ?)
     ON CONFLICT(hypothesis_id, pain_group_id, direction) DO NOTHING`,
  ).bind(id, groupId, direction).run();
  return json({ ok: true }, 201);
});

founderValidate.delete('/links/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const owner = await c.env.DB.prepare(
    `SELECT h.project_id FROM hypothesis_pain_links l
       JOIN hypotheses h ON h.id = l.hypothesis_id WHERE l.id = ?`,
  ).bind(id).first<{ project_id: number }>();
  if (!owner) return notFound('Link');
  const s = await scope(c, Number(owner.project_id), canWrite);
  if (s instanceof Response) return s;
  await c.env.DB.prepare('DELETE FROM hypothesis_pain_links WHERE id = ?').bind(id).run();
  return json({ ok: true });
});

// ---------------------------------------------------------------------------
// The founder's decision — narrower audience than everything above
// ---------------------------------------------------------------------------

founderValidate.get('/decision/:projectId', async (c) => {
  const s = await scope(c, Number(c.req.param('projectId')), canReadDecision);
  if (s instanceof Response) return s;
  const res = await c.env.DB.prepare(
    `SELECT id, decision, reasoning, decided_at, superseded_at
       FROM validation_decisions WHERE project_id = ?
      ORDER BY decided_at DESC, id DESC`,
  ).bind(s.project.id).all<any>().catch(() => ({ results: [] as any[] }));
  const rows = res.results || [];
  return json({
    current: rows.find((r) => !r.superseded_at) || null,
    history: rows,
  });
});

founderValidate.post('/decision/:projectId', async (c) => {
  const s = await scope(c, Number(c.req.param('projectId')), canWrite);
  if (s instanceof Response) return s;
  const b = await c.req.json().catch(() => ({} as any));
  const decision = String(b.decision || '');
  if (!DECISIONS.has(decision)) return json({ detail: 'decision must be proceed, pivot or stop' }, 400);

  // Supersede rather than overwrite. A decision that vanishes when the next one
  // is taken is a record of the current mood, not of a decision.
  await c.env.DB.prepare(
    "UPDATE validation_decisions SET superseded_at = datetime('now') WHERE project_id = ? AND superseded_at IS NULL",
  ).bind(s.project.id).run();
  const r = await c.env.DB.prepare(
    `INSERT INTO validation_decisions (project_id, decision, reasoning, decided_by)
     VALUES (?, ?, ?, ?)`,
  ).bind(s.project.id, decision, trimOrNull(b.reasoning), s.user.id).run();
  return json({ id: r.meta?.last_row_id, decision }, 201);
});

// ---------------------------------------------------------------------------
// The four facts about an interview that make the numbers above mean something
// ---------------------------------------------------------------------------

founderValidate.patch('/interviews/:id/evidence', async (c) => {
  const id = Number(c.req.param('id'));
  const owner = await c.env.DB.prepare(
    'SELECT project_id FROM discovery_interviews WHERE id = ?',
  ).bind(id).first<{ project_id: number }>();
  if (!owner) return notFound('Interview');
  const s = await scope(c, Number(owner.project_id), canWrite);
  if (s instanceof Response) return s;

  const b = await c.req.json().catch(() => ({} as any));
  // Each field is only written when the caller actually sent it. `undefined`
  // leaves the column alone; an explicit null clears it back to not-recorded.
  if ('icp_fit' in b) {
    const v = b.icp_fit == null ? null : String(b.icp_fit);
    if (v !== null && !ICP_VALUES.has(v)) return json({ detail: 'icp_fit must be strong, partial or none' }, 400);
    await c.env.DB.prepare(
      "UPDATE discovery_interviews SET icp_fit = ?, updated_at = datetime('now') WHERE id = ?",
    ).bind(v, id).run();
  }
  if ('quote_consent' in b) {
    // Three states, and the third is the reason this column is nullable:
    // asked-and-yes, asked-and-no, never asked.
    const v = b.quote_consent == null ? null : (b.quote_consent ? 1 : 0);
    await c.env.DB.prepare(
      "UPDATE discovery_interviews SET quote_consent = ?, updated_at = datetime('now') WHERE id = ?",
    ).bind(v, id).run();
  }
  if ('interviewee_company' in b) {
    await c.env.DB.prepare(
      "UPDATE discovery_interviews SET interviewee_company = ?, updated_at = datetime('now') WHERE id = ?",
    ).bind(trimOrNull(b.interviewee_company), id).run();
  }
  return json({ ok: true });
});

export default founderValidate;
