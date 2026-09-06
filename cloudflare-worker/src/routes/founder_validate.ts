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
import { loadPainGroupModel, normPhrase, getPainGroupsView } from '../services/painGroups';
import { csvResponse, stamp } from '../services/csv';
import {
  serializeInterviewsCsv, serializePainMapCsv, serializeSummaryCsv,
  type ExportInterviewRow,
} from './_founder_validate_exports';
import { ensureDiscoveryEvidenceColumns, ensureDiscoveryRecordingColumns } from '../services/discoveryInterviewSchema';
import {
  canReadBoard, canReadDecision, canWrite,
  verdictFor, laneFor, barNoteFor, evidenceFor, isIcp, VALIDATION_BAR,
  type ProjectRef,
} from './_founder_validate_helpers';
import { insertHypothesis, upsertPainAlias } from './_founder_validate_writes';
import {
  DRAFT_PROMPT, MAX_PROMPT_ITEMS, PROPOSAL_KINDS, TAG_PROMPT, TASK_FOR_KIND,
  listPending, parseDraftProposals, parseTagProposals, priorPayloads,
  type HypothesisPayload, type ProposalKind, type TagPayload,
} from './_founder_validate_proposals';
import { run as aiRun, audioMinutesFromBytes } from '../services/aiRouter';

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

/**
 * The board, built once.
 *
 * Extracted when the CSV export arrived: a second copy of this orchestration
 * would be a second answer to "what lane is H3 in", and the two would part
 * company the first time either was edited. The counts are derived, never
 * stored, precisely so there is one answer — deriving them twice from two
 * places gives that away again.
 */
async function buildBoard(env: Env, projectId: number) {
  const hyps = await env.DB.prepare(
    `SELECT id, code, claim, sort_order, retired_at
       FROM hypotheses WHERE project_id = ? ORDER BY sort_order, id`,
  ).bind(projectId).all<any>().catch(() => ({ results: [] as any[] }));

  const linkRes = await env.DB.prepare(
    `SELECT l.id, l.hypothesis_id, l.pain_group_id, l.direction
       FROM hypothesis_pain_links l
       JOIN hypotheses h ON h.id = l.hypothesis_id
      WHERE h.project_id = ?`,
  ).bind(projectId).all<any>().catch(() => ({ results: [] as any[] }));

  const { interviews, model } = await loadEvidenceBase(env, projectId);
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

  return {
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
  };
}

founderValidate.get('/board/:projectId', async (c) => {
  const s = await scope(c, Number(c.req.param('projectId')), canReadBoard);
  if (s instanceof Response) return s;
  const board = await buildBoard(c.env, s.project.id);
  return json({ project: { id: s.project.id, name: s.project.name }, ...board });
});

founderValidate.post('/board/:projectId/hypotheses', async (c) => {
  const s = await scope(c, Number(c.req.param('projectId')), canWrite);
  if (s instanceof Response) return s;
  const b = await c.req.json().catch(() => ({} as any));
  const claim = trimOrNull(b.claim);
  if (!claim) return json({ detail: 'A hypothesis needs a claim' }, 400);

  // Through the shared writer, which is also what accepting an AI proposal
  // calls. `code` is allocated from the highest ever used rather than the
  // current count — retiring H2 must not hand "H2" to a different claim later
  // — and a second insert with its own idea of that rule is exactly how the
  // allocation would quietly start handing out duplicates.
  const row = await insertHypothesis(c.env, s.project.id, claim);
  return json(row, 201);
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

// ---------------------------------------------------------------------------
// The three exports
//
// GET, not POST: none of these takes a filter, so the URL is the whole request
// and a person can bookmark or curl it. (`admin.ts`'s transcript export is a
// POST precisely because it does take filters.)
//
// Each caps its rows. A Worker materialises the whole body in memory, so an
// unbounded export is an outage waiting for the venture that logs 40,000
// interviews — and `X-Export-Rows` tells the caller what it actually got, so a
// truncated file cannot be mistaken for a complete one.
// ---------------------------------------------------------------------------

/**
 * Row cap, written as a literal in the SQL below rather than interpolated.
 *
 * `scripts/check-sql-prepare.mjs` refuses ANY `${…}` inside a `DB.prepare`
 * template — a constant reads the same as a variable at the point the query
 * text is built, and the guard is right to not try to tell them apart. Keeping
 * the number in one place means keeping it in the statement, so there is no
 * second copy to drift: 5000 is enough that no real venture reaches it, and
 * small enough that a bug cannot exhaust a Worker's memory. `admin.ts`'s
 * transcript export uses the same figure for the same reason.
 */

/** `Acme_Robotics-interviews-2026-09-06.csv` — the worker's two filename idioms at once. */
const exportName = (projectName: string, what: string) =>
  `${String(projectName || 'venture').replace(/[^A-Za-z0-9._-]/g, '_')}-${what}-${stamp()}.csv`;

founderValidate.get('/interviews/:projectId/export.csv', async (c) => {
  const s = await scope(c, Number(c.req.param('projectId')), canReadBoard);
  if (s instanceof Response) return s;

  // 211's columns are ensured before they are named, the same way the board
  // does it: on an environment where the migration has not run, "no such
  // column" would otherwise read as "no interviews".
  await ensureDiscoveryEvidenceColumns(c.env);
  const res = await c.env.DB.prepare(
    `SELECT id, interviewee_name, interviewee_role, interviewee_company,
            interview_date, icp_fit, quote_consent, featured,
            validation_rating, validation_comment, notes, pains_json
       FROM discovery_interviews WHERE project_id = ?
      ORDER BY interview_date DESC, id DESC LIMIT 5000`,
  ).bind(s.project.id).all<ExportInterviewRow>().catch(() => ({ results: [] as ExportInterviewRow[] }));

  const rows = res.results || [];
  return csvResponse(
    serializeInterviewsCsv(rows),
    exportName(s.project.name, 'interviews'),
    { 'X-Export-Rows': String(rows.length) },
  );
});

founderValidate.get('/pain-map/:projectId/export.csv', async (c) => {
  const s = await scope(c, Number(c.req.param('projectId')), canReadBoard);
  if (s instanceof Response) return s;
  const view = await getPainGroupsView(c.env, s.project.id);
  return csvResponse(
    serializePainMapCsv(view),
    exportName(s.project.name, 'pain-map'),
    { 'X-Export-Rows': String(view.groups.length + view.ungrouped.length) },
  );
});

// `canReadDecision`, NOT `canReadBoard`: this file carries the founder's own
// proceed/pivot/stop, which partners may not read. Gating the whole export on
// the stricter of the two rules is easier to reason about than one that
// silently drops a section for some callers — and the board itself is still
// readable in the app by anyone `canReadBoard` admits.
founderValidate.get('/summary/:projectId/export.csv', async (c) => {
  const s = await scope(c, Number(c.req.param('projectId')), canReadDecision);
  if (s instanceof Response) return s;

  const board = await buildBoard(c.env, s.project.id);
  const cur = await c.env.DB.prepare(
    `SELECT decision, reasoning, decided_at FROM validation_decisions
      WHERE project_id = ? AND superseded_at IS NULL
      ORDER BY decided_at DESC, id DESC LIMIT 1`,
  ).bind(s.project.id).first<{ decision: string; reasoning: string | null; decided_at: string | null }>()
    .catch(() => null);

  return csvResponse(
    serializeSummaryCsv(board.hypotheses as any, cur || null),
    exportName(s.project.name, 'validation-summary'),
    { 'X-Export-Rows': String(board.hypotheses.length) },
  );
});

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

// ---------------------------------------------------------------------------
// "AI fills the blanks" — proposals, and the two decisions a person makes
// about each one.
//
// Nothing here runs unless the founder asked for it. The rail's toggle is off
// until they turn it on (DECISIONS D17 amended), and even on, a proposal is
// written only when this route is called. The mode does not poll.
// ---------------------------------------------------------------------------

/** Rows a run may be built from, capped so a long project cannot run away. */
const CAP = MAX_PROMPT_ITEMS;

founderValidate.post('/propose/:projectId', async (c) => {
  const s = await scope(c, Number(c.req.param('projectId')), canWrite);
  if (s instanceof Response) return s;

  const b = await c.req.json().catch(() => ({} as any));
  const kind = String(b.kind || '') as ProposalKind;
  if (!PROPOSAL_KINDS.has(kind)) return json({ detail: 'kind must be pain_tag or hypothesis' }, 400);
  // Passed through unvalidated: `run()` owns the allow-list, and a second copy
  // here is a second thing to keep true.
  const model = String(b.model || '').trim().slice(0, 120) || undefined;

  const view = await getPainGroupsView(c.env, s.project.id);
  const groups = view.groups.map((g) => ({ id: Number(g.id), title: String(g.title) }));
  const already = await priorPayloads(c.env, s.project.id, kind);

  let systemPrompt: string;
  let facts: string;
  if (kind === 'pain_tag') {
    // Only phrases that are not already in a theme, and only themes that
    // exist. With neither there is nothing to sort, and saying so is better
    // than spending a run to be told the same thing by a model.
    const ungrouped = view.ungrouped.map((u) => String(u.display_phrase)).slice(0, CAP);
    if (!groups.length) {
      return json({ error: 'no_themes', message: 'There are no pain themes to sort into yet. Group one phrase by hand first.' }, 400);
    }
    if (!ungrouped.length) {
      return json({ error: 'nothing_to_propose', message: 'Every logged phrase is already in a theme.' }, 400);
    }
    systemPrompt = TAG_PROMPT;
    facts = [
      'Themes:',
      ...groups.map((g) => `  ${g.id}: ${g.title}`),
      '',
      'Ungrouped phrases:',
      ...ungrouped.map((p) => `  - ${p}`),
    ].join('\n');
  } else {
    if (!groups.length) {
      return json({ error: 'nothing_to_propose', message: 'There are no pain themes to draft a claim from yet.' }, 400);
    }
    systemPrompt = DRAFT_PROMPT;
    facts = [
      'Pain themes, with how many interviews mentioned each:',
      ...view.groups.slice(0, CAP).map((g) => `  - ${g.title} (${g.count} of ${view.interview_total} interviews)`),
    ].join('\n');
  }

  const r = await aiRun(c.env, {
    task: TASK_FOR_KIND[kind] as any,
    userId: s.user.id,
    model,
    systemPrompt,
    messages: [{ role: 'user', content: facts }],
    maxTokens: 500,
    temperature: 0.3,
  });

  // `run` never throws — a spent budget and an unreachable model both arrive
  // as refusals with their reason intact, and both must keep it.
  if (!r.ok) {
    return json({
      ok: false,
      refusal: r.refusal ?? null,
      message: r.refusal === 'model_not_offered'
        ? 'That model is no longer offered for this. Nothing was run.'
        : r.refusal === 'budget_user_month' || r.refusal === 'budget_user_day'
          ? 'This month’s AI budget is spent. Nothing was run.'
          : 'The model could not be reached. Nothing was run, and nothing was charged.',
      usage: { model: r.usage.model, est_cost_usd: 0 },
    }, 503);
  }

  // EVERY item is matched back against something that exists before it can
  // become a row. See `_founder_validate_proposals.ts` for what each parser
  // refuses and why.
  const items: Array<TagPayload | HypothesisPayload> = kind === 'pain_tag'
    ? parseTagProposals(r.output || '', view.ungrouped.map((u) => String(u.display_phrase)), groups)
    : parseDraftProposals(r.output || '', [
      ...(await c.env.DB.prepare('SELECT claim FROM hypotheses WHERE project_id = ?')
        .bind(s.project.id).all<{ claim: string }>()).results.map((h) => String(h.claim)),
      // Anything already offered, accepted or thrown away, counts as taken.
      ...already.map((p) => { try { return String(JSON.parse(p)?.claim || ''); } catch { return ''; } }),
    ]);

  const created: Array<{ id: number; kind: string; payload: unknown }> = [];
  for (const payload of items) {
    const ins = await c.env.DB.prepare(
      `INSERT INTO validate_proposals (project_id, kind, payload_json, model, task, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      s.project.id, kind, JSON.stringify(payload),
      // The model that ACTUALLY ran, from the router's usage metadata. Not the
      // one that was asked for: the router falls back to a smaller sibling
      // under load, and recording the request would put one model's name over
      // another model's sentence.
      r.usage.model, r.usage.task, s.user.id,
    ).run();
    created.push({ id: Number(ins.meta?.last_row_id || 0), kind, payload });
  }

  return json({
    ok: true,
    proposals: created,
    usage: {
      model: r.usage.model,
      est_cost_usd: r.usage.est_cost_usd,
      prompt_tokens: r.usage.prompt_tokens,
      completion_tokens: r.usage.completion_tokens,
      fallback_used: r.usage.fallback_used,
    },
  }, 201);
});

founderValidate.get('/proposals/:projectId', async (c) => {
  const s = await scope(c, Number(c.req.param('projectId')), canReadBoard);
  if (s instanceof Response) return s;
  const rows = await listPending(c.env, s.project.id);
  return json({
    proposals: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      model: row.model,
      created_at: row.created_at,
      payload: (() => { try { return JSON.parse(row.payload_json); } catch { return null; } })(),
    })).filter((p) => p.payload !== null),
  });
});

type ProposalRow = {
  id: number; project_id: number; kind: string; payload_json: string; status: string;
};

/** The proposal plus the project that owns it, or null. */
async function loadProposal(env: Env, id: number): Promise<ProposalRow | null> {
  return env.DB.prepare(
    'SELECT id, project_id, kind, payload_json, status FROM validate_proposals WHERE id = ?',
  ).bind(id).first<ProposalRow>();
}

founderValidate.post('/proposals/:id/accept', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await loadProposal(c.env, id);
  if (!row) return notFound('Proposal');
  const s = await scope(c, Number(row.project_id), canWrite);
  if (s instanceof Response) return s;

  // CLAIM FIRST, atomically. `WHERE status = 'pending'` is what stops two
  // founders both accepting one proposal and writing the row twice — the same
  // idiom `routes/pipeline.ts` uses on `decision_gates`. D1's HTTP API has no
  // multi-statement transaction to wrap the claim and the write together, so
  // the claim goes first and the write follows; a write that then fails puts
  // the row back to pending rather than leaving an "accepted" proposal that
  // wrote nothing.
  const claim = await c.env.DB.prepare(
    `UPDATE validate_proposals
        SET status = 'accepted', decided_by = ?, decided_at = datetime('now')
      WHERE id = ? AND status = 'pending'`,
  ).bind(s.user.id, id).run();
  if (!claim.meta?.changes) {
    return json({ detail: 'That proposal has already been decided' }, 409);
  }

  const revert = async () => {
    await c.env.DB.prepare(
      "UPDATE validate_proposals SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = ?",
    ).bind(id).run();
  };

  let payload: any;
  try { payload = JSON.parse(row.payload_json); } catch { payload = null; }
  if (!payload) { await revert(); return json({ detail: 'That proposal could not be read' }, 422); }

  try {
    if (row.kind === 'pain_tag') {
      const ok = await upsertPainAlias(c.env, row.project_id, Number(payload.pain_group_id), String(payload.phrase));
      // The theme may have been renamed away or deleted since the proposal was
      // written. That is not an error in the proposal and not a 500: it is a
      // proposal that no longer applies, and it goes back to pending so the
      // founder sees it rather than silently losing it.
      if (!ok) { await revert(); return json({ detail: 'That theme no longer exists' }, 409); }
      return json({ ok: true, kind: row.kind });
    }
    const written = await insertHypothesis(c.env, row.project_id, String(payload.claim || '').trim());
    return json({ ok: true, kind: row.kind, hypothesis: written }, 201);
  } catch (e) {
    await revert();
    return json({ detail: 'That proposal could not be applied', error: (e as Error).message }, 500);
  }
});

founderValidate.post('/proposals/:id/discard', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await loadProposal(c.env, id);
  if (!row) return notFound('Proposal');
  const s = await scope(c, Number(row.project_id), canWrite);
  if (s instanceof Response) return s;

  // Discarded, never deleted. What the machine suggested and a person rejected
  // is a fact about both, and the propose path reads it back so the same
  // suggestion is not offered twice.
  const r = await c.env.DB.prepare(
    `UPDATE validate_proposals
        SET status = 'discarded', decided_by = ?, decided_at = datetime('now')
      WHERE id = ? AND status = 'pending'`,
  ).bind(s.user.id, id).run();
  if (!r.meta?.changes) return json({ detail: 'That proposal has already been decided' }, 409);
  return json({ ok: true });
});

// ---------------------------------------------------------------------------
// A recording, and the text it becomes.
//
// The third thing the mode note promises, and the one migration 214 said it
// could not keep. Two routes, in the order a person uses them: put the audio
// somewhere, then ask for words.
// ---------------------------------------------------------------------------

/**
 * 20 MB, the same ceiling `research.ts` and `deck_reviewer.ts` use — and here
 * it is a memory bound as well as a policy one. The router hands Workers AI
 * `Array.from(bytes)`, which materialises a JS number[] at roughly 8 bytes an
 * element against the isolate's 128 MB, so this is what keeps a transcription
 * from OOMing rather than failing. At the 32 kbps this product assumes, 20 MB
 * is about 83 minutes of speech.
 */
const MAX_RECORDING_BYTES = 20 * 1024 * 1024;

/**
 * What a browser's MediaRecorder actually produces, plus the two container
 * types a founder is likely to drag in from a phone. An allowlist and not a
 * prefix check on `audio/`: `audio/*` would admit anything a client cares to
 * label, and the model has to decode it.
 */
const AUDIO_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

/** The interview plus the project that owns it, or null. */
type InterviewOwner = { id: number; project_id: number };
async function loadInterview(env: Env, id: number): Promise<InterviewOwner | null> {
  return env.DB.prepare(
    'SELECT id, project_id FROM discovery_interviews WHERE id = ?',
  ).bind(id).first<InterviewOwner>();
}

founderValidate.post('/interviews/:id/recording', async (c) => {
  const id = Number(c.req.param('id'));
  const owner = await loadInterview(c.env, id);
  if (!owner) return notFound('Interview');
  const s = await scope(c, Number(owner.project_id), canWrite);
  if (s instanceof Response) return s;

  // `FILES` is optional in types.ts, so a missing bucket is a 503 with a reason
  // rather than a crash — the same shape data_room.ts and research.ts use.
  if (!c.env.FILES) return json({ detail: 'storage_not_configured' }, 503);
  if (!(await ensureDiscoveryRecordingColumns(c.env))) {
    return json({ detail: 'recording_columns_unavailable' }, 503);
  }

  let form: FormData;
  try { form = await c.req.formData(); } catch { return json({ detail: 'invalid_form' }, 400); }
  // Workers-types declares FormData entries as string; at runtime an upload is
  // a File. Narrowing out the string case is load-bearing, not defensive.
  const entry = form.get('file') as unknown;
  if (!entry || typeof entry === 'string') return json({ detail: 'file_required' }, 400);
  const file = entry as File;

  const mime = String(file.type || '').toLowerCase();
  const ext = AUDIO_MIME[mime];
  if (!ext) return json({ detail: 'unsupported_type', accepted: Object.keys(AUDIO_MIME) }, 415);
  if (file.size > MAX_RECORDING_BYTES) {
    return json({ detail: 'too_large', max_bytes: MAX_RECORDING_BYTES }, 413);
  }
  if (!file.size) return json({ detail: 'empty_file' }, 400);

  // For DISPLAY only, and clamped. Billing reads the byte length instead —
  // a number the client chooses must not decide what a run costs. See
  // `audioMinutesFromBytes`.
  const rawDuration = Number(form.get('duration_sec'));
  const durationSec = Number.isFinite(rawDuration) && rawDuration > 0
    ? Math.min(Math.round(rawDuration), 24 * 3600)
    : null;

  // DERIVED SERVER-SIDE, NEVER TAKEN FROM THE REQUEST. A caller-supplied key is
  // a path-traversal write into another account's prefix.
  const key = `validate-audio/${s.user.id}/${crypto.randomUUID()}.${ext}`;
  try {
    await c.env.FILES.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: mime },
      customMetadata: {
        owner_user_id: String(s.user.id),
        project_id: String(owner.project_id),
        interview_id: String(id),
      },
    });
  } catch (e) {
    console.error('[founder_validate] R2 put failed:', (e as Error).message);
    return json({ detail: 'storage_write_failed' }, 502);
  }

  // The previous recording, if any, is orphaned rather than deleted: a delete
  // that raced a transcription would pull the bytes out from under it. The R2
  // lifecycle sweeps the prefix; what matters here is that the row points at
  // one object and that object exists.
  await c.env.DB.prepare(
    `UPDATE discovery_interviews
        SET recording_r2_key = ?, recording_mime = ?, recording_size_bytes = ?,
            recording_duration_sec = ?, recording_uploaded_at = datetime('now'),
            updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(key, mime, file.size, durationSec, id).run();

  return json({
    ok: true,
    size_bytes: file.size,
    duration_sec: durationSec,
    // What a transcription of this clip would cost, before running it. Derived
    // from the same function that bills it, so the quote and the charge cannot
    // disagree.
    estimated_audio_minutes: audioMinutesFromBytes(file.size),
  }, 201);
});

founderValidate.post('/interviews/:id/transcribe', async (c) => {
  const id = Number(c.req.param('id'));
  const owner = await loadInterview(c.env, id);
  if (!owner) return notFound('Interview');
  const s = await scope(c, Number(owner.project_id), canWrite);
  if (s instanceof Response) return s;
  if (!c.env.FILES) return json({ detail: 'storage_not_configured' }, 503);
  if (!(await ensureDiscoveryRecordingColumns(c.env))) {
    return json({ detail: 'recording_columns_unavailable' }, 503);
  }

  const row = await c.env.DB.prepare(
    'SELECT recording_r2_key, recording_size_bytes FROM discovery_interviews WHERE id = ?',
  ).bind(id).first<{ recording_r2_key: string | null; recording_size_bytes: number | null }>();
  if (!row?.recording_r2_key) {
    return json({ error: 'no_recording', message: 'There is no recording on this interview yet.' }, 400);
  }

  // Hard guard on the prefix before reading, the idiom `services/r2.ts` states
  // at each of its getters: never serve or read outside the prefix this feature
  // owns, whatever the stored key says.
  if (!row.recording_r2_key.startsWith('validate-audio/')) {
    console.error('[founder_validate] refusing a key outside validate-audio/');
    return json({ detail: 'storage_read_failed' }, 502);
  }

  const obj = await c.env.FILES.get(row.recording_r2_key);
  if (!obj) return json({ error: 'no_recording', message: 'The recording could not be read.' }, 404);
  const bytes = new Uint8Array(await obj.arrayBuffer());

  const r = await aiRun(c.env, {
    task: 'transcribe',
    userId: s.user.id,
    audio: bytes,
    // From the BYTES, not from the duration the client reported.
    audioMinutes: audioMinutesFromBytes(Number(row.recording_size_bytes || bytes.byteLength)),
  });

  if (!r.ok) {
    return json({
      ok: false,
      refusal: r.refusal ?? null,
      message: r.refusal === 'budget_user_month' || r.refusal === 'budget_user_day'
        ? 'This month’s AI budget is spent. Nothing was run.'
        : 'The recording could not be transcribed. Nothing was charged.',
      usage: { model: r.usage.model, est_cost_usd: 0 },
    }, 503);
  }

  // An empty transcript is an ANSWER: the clip had no speech in it. Stored as
  // an empty string rather than left NULL, so the page stops offering a
  // transcription that would cost the same and return the same nothing.
  const text = r.output ?? '';
  await c.env.DB.prepare(
    `UPDATE discovery_interviews
        SET transcript = ?, transcribed_at = datetime('now'), transcribed_by_model = ?,
            updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(text, r.usage.model, id).run();

  return json({
    ok: true,
    transcript: text,
    usage: {
      model: r.usage.model,
      est_cost_usd: r.usage.est_cost_usd,
      audio_minutes: audioMinutesFromBytes(Number(row.recording_size_bytes || bytes.byteLength)),
    },
  });
});

export default founderValidate;
