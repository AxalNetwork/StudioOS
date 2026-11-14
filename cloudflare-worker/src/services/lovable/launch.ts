/**
 * D1082 (#2947) — Build in Lovable: the draft, the check and the launch, for
 * an experiment (Validate) and for Prototype / MVP (Build).
 *
 *   draft   the record's prompt from its template, its length, the "Left
 *           out" line, the privacy check, and when it was last opened
 *   check   the privacy check on the founder's edited prompt
 *   launch  the check again, then one `build_handoffs` row (provider
 *           'lovable', D1068's store) and one activity line in one batch,
 *           and the Lovable link, which the page opens in a new tab
 *
 * StudioOS records its own fact, the founder's press, and nothing else: the
 * Worker never calls Lovable, and nothing comes back here (part 3, #2948,
 * reads the app's address). Logs keep counts and outcomes, never the prompt.
 */
import { liveAddress } from './signups';
import type { Env, User } from '../../types';
import { requireAuth, selectJwt } from '../../auth';
import { logCycleWriteStatement } from '../cycleActivity';
import { canReadBoard, canWrite, type ProjectRef } from '../../routes/_founder_validate_helpers';
import {
  LEFT_OUT, LOVABLE_PROMPT_MAX, buildWithUrl, checkLine, landingTestPrompt, privacyFindings, prototypePrompt, type Finding,
} from './prompt';

export type LovableCycle = 'validate' | 'build';
export type RecordRef = { kind: 'experiment' | 'prototype'; id: string };

export class LovableError extends Error {
  code: string;
  status: 400 | 403 | 404 | 422;
  sentence: string;
  extra: Record<string, unknown>;
  constructor(code: string, status: 400 | 403 | 404 | 422, sentence: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.code = code; this.status = status; this.sentence = sentence; this.extra = extra;
  }
}

/** Which record kind each cycle launches from, and how a handoff names it. */
const KINDS = {
  validate: { kind: 'experiment', table: 'hypothesis_experiments', module: 'experiments' },
  // Prototype / MVP is the venture's must-have list, so a handoff names the venture.
  build: { kind: 'prototype', table: 'projects', module: 'prototype-mvp' },
} as const;

const ID = /^[1-9][0-9]{0,9}$/;

/** The body's record, checked against the cycle: an experiment's id, or the venture's own id for Prototype / MVP. */
export function recordOf(cycle: LovableCycle, projectId: number, raw: unknown): RecordRef {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const id = String(r.id ?? '');
  if (r.kind !== KINDS[cycle].kind || !ID.test(id)) {
    throw new LovableError('invalid_record', 400, cycle === 'validate' ? 'Choose an experiment to build.' : 'Choose Prototype / MVP to build.');
  }
  if (cycle === 'build' && Number(id) !== projectId) throw new LovableError('invalid_record', 400, 'Choose this venture’s Prototype / MVP.');
  return { kind: KINDS[cycle].kind, id };
}

/** The dialog's "What this tests" (the owner's re-export, D1311 §3): the record's own words, never more. */
export type Tests = { code: string | null; claim: string | null; title: string | null; target: string | null };
type Drafted = { prompt: string; dropped: number; hypothesisId: number | null; tests: Tests };

async function drafted(env: Env, cycle: LovableCycle, projectId: number, ref: RecordRef): Promise<Drafted> {
  const venture = await env.DB.prepare('SELECT name, description FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(projectId).first<{ name: string; description: string | null }>();
  if (!venture) throw new LovableError('not_found', 404, 'This venture could not be found.');
  if (cycle === 'validate') {
    const e = await env.DB.prepare(`SELECT e.title, e.method, e.target, e.hypothesis_id, h.code, h.claim
      FROM hypothesis_experiments e JOIN hypotheses h ON h.id = e.hypothesis_id AND h.project_id = e.project_id
      WHERE e.id = ? AND e.project_id = ?`).bind(Number(ref.id), projectId)
      .first<{ title: string; method: string | null; target: string | null; hypothesis_id: number; code: string | null; claim: string }>();
    if (!e) throw new LovableError('not_found', 404, 'This experiment is not on this venture.');
    const signupUrl = await liveAddress(env, projectId, Number(ref.id)).catch(() => null);
    const { prompt, dropped } = landingTestPrompt({ venture: venture.name, description: venture.description, code: e.code, claim: e.claim, title: e.title, method: e.method, target: e.target, signupUrl });
    return { prompt, dropped, hypothesisId: Number(e.hypothesis_id), tests: { code: e.code ?? null, claim: e.claim ?? null, title: e.title ?? null, target: e.target ?? null } };
  }
  const p = await env.DB.prepare('SELECT mvp_target_date FROM projects WHERE id = ?').bind(projectId).first<{ mvp_target_date: string | null }>();
  const features = (await env.DB.prepare(`SELECT title, description FROM mvp_features
    WHERE project_id = ? AND is_must_have = 1 AND (scope IS NULL OR scope != 'out') ORDER BY sort_order, id`).bind(projectId)
    .all<{ title: string; description: string | null }>()).results || [];
  const { prompt, dropped } = prototypePrompt({ venture: venture.name, description: venture.description, mustHaves: features, targetDate: p?.mvp_target_date ?? null });
  return { prompt, dropped, hypothesisId: null, tests: { code: null, claim: venture.name, title: `Prototype / MVP · ${features.length} must-have${features.length === 1 ? '' : 's'}`, target: null } };
}

/** When this record was last opened in Lovable, or null. */
async function lastOpened(env: Env, cycle: LovableCycle, projectId: number, ref: RecordRef): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT MAX(opened_at) AS at FROM build_handoffs
    WHERE project_id = ? AND provider = 'lovable' AND record_table = ? AND record_id = ?`)
    .bind(projectId, KINDS[cycle].table, ref.id).first<{ at: string | null }>();
  return row?.at ?? null;
}

const view = (findings: Finding[]) => ({ ok: findings.length === 0, line: checkLine(findings), findings });

/** The dialog's opening read. */
export async function draftPrompt(env: Env, cycle: LovableCycle, projectId: number, rawRecord: unknown) {
  const ref = recordOf(cycle, projectId, rawRecord);
  const d = await drafted(env, cycle, projectId, ref);
  const findings = await privacyFindings(env, projectId, d.prompt);
  return {
    record: ref, prompt: d.prompt, prompt_chars: d.prompt.length, max: LOVABLE_PROMPT_MAX, left_out: LEFT_OUT,
    ...(d.dropped ? { cut: `${d.dropped} ${d.dropped === 1 ? 'line was' : 'lines were'} left out to stay within ${LOVABLE_PROMPT_MAX.toLocaleString('en-US')} characters.` } : {}),
    check: view(findings), last_opened_at: await lastOpened(env, cycle, projectId, ref), tests: d.tests,
  };
}

function promptOf(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new LovableError('invalid_prompt', 400, 'Write the prompt first.');
  if (raw.length > LOVABLE_PROMPT_MAX) {
    throw new LovableError('too_long', 422, `The prompt is ${raw.length.toLocaleString('en-US')} characters; Lovable takes ${LOVABLE_PROMPT_MAX.toLocaleString('en-US')}. Shorten it.`, { prompt_chars: raw.length, max: LOVABLE_PROMPT_MAX });
  }
  return raw;
}

/** The dialog's check on an edited prompt. */
export async function checkPrompt(env: Env, projectId: number, raw: unknown) {
  const prompt = promptOf(raw);
  return { prompt_chars: prompt.length, check: view(await privacyFindings(env, projectId, prompt)) };
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Open in Lovable: every check first, then the row and the activity line together, then the link. */
export async function launchPrompt(env: Env, user: User, cycle: LovableCycle, projectId: number, body: Record<string, unknown>) {
  const ref = recordOf(cycle, projectId, body.record);
  const prompt = promptOf(body.prompt);
  const d = await drafted(env, cycle, projectId, ref);
  const findings = await privacyFindings(env, projectId, prompt);
  if (findings.length) {
    throw new LovableError('pii_found', 422, `${checkLine(findings)} Nothing was opened.`, { findings, check: view(findings) });
  }
  const uid = crypto.randomUUID();
  const k = KINDS[cycle];
  const stmts = [
    env.DB.prepare(`INSERT INTO build_handoffs (uid, project_id, provider, module, record_table, record_id, plan_item_uids, target, prompt_text, prompt_chars, text_hash, marker, opened_by)
      SELECT ?, ?, 'lovable', ?, ?, ?, '[]', 'lovable.dev', ?, ?, ?, NULL, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND deleted_at IS NULL)`)
      .bind(uid, projectId, k.module, k.table, ref.id, prompt, prompt.length, await sha256(prompt), user.id, projectId),
    cycle === 'validate'
      ? logCycleWriteStatement(env, { projectId, userId: user.id, cycle: 'validate', module: 'experiments', entityId: d.hypothesisId,
        action: 'lovable_opened', summary: 'Experiment opened in Lovable' })
      : logCycleWriteStatement(env, { projectId, userId: user.id, cycle: 'build', module: 'prototype-mvp', entityId: 'project',
        action: 'lovable_opened', summary: 'Prototype / MVP opened in Lovable' }),
  ];
  const results = await env.DB.batch(stmts);
  if (!results[0]?.meta?.changes) throw new LovableError('not_found', 404, 'This venture could not be found.');
  const row = await env.DB.prepare('SELECT opened_at FROM build_handoffs WHERE uid = ?').bind(uid).first<{ opened_at: string }>();
  console.info('[lovable] opened', { cycle, prompt_chars: prompt.length });
  return { url: buildWithUrl(prompt), handoff: { uid, opened_at: row?.opened_at ?? null } };
}

/** LV4: when each record of the cycle was last opened in Lovable. */
export async function launchesOf(env: Env, cycle: LovableCycle, projectId: number) {
  const table = KINDS[cycle].table;
  const rows = (await env.DB.prepare(`SELECT record_id, MAX(opened_at) AS opened_at, COUNT(*) AS times FROM build_handoffs
    WHERE project_id = ? AND provider = 'lovable' AND record_table = ? GROUP BY record_id ORDER BY record_id`)
    .bind(projectId, table).all<{ record_id: string; opened_at: string; times: number }>()).results || [];
  return { launches: rows.map((r) => ({ record: { kind: KINDS[cycle].kind, id: String(r.record_id) }, opened_at: r.opened_at, times: Number(r.times) })) };
}

// ─────────────────────────────────────────────── the routes' one handler


type Step = 'draft' | 'check' | 'launch' | 'launches';

/**
 * The four routes each cycle mounts (`cycle_validate.ts`, `cycle_build.ts`):
 *   POST /lovable/draft, /lovable/check, /lovable/launch  { project_id, record, prompt? }
 *   GET  /lovable/launches?project=
 * Writing is the venture's own or an admin's (`canWrite`), and reading the
 * launches is the board's audience. A support session may look but never
 * opens Lovable as the founder: launch refuses it.
 */
export function lovableHandler(cycle: LovableCycle, step: Step) {
  return async (c: any) => {
    let user: User;
    try { user = (await requireAuth(c)) as User; } catch { return c.json({ detail: 'Unauthorized' }, 401); }
    const body = step === 'launches' ? {} : await c.req.json().catch(() => null);
    if (step !== 'launches' && (!body || typeof body !== 'object' || Array.isArray(body))) return c.json({ detail: 'Send a JSON body.', code: 'invalid_body' }, 400);
    const raw = String(step === 'launches' ? c.req.query('project') ?? '' : (body as any).project_id ?? '');
    if (!ID.test(raw)) return c.json({ detail: 'project_id is required', code: 'invalid_project' }, 400);
    const projectId = Number(raw);
    const project = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(projectId).first() as ProjectRef | null;
    if (!project) return c.json({ detail: 'Project not found', code: 'not_found' }, 404);
    if (!(step === 'launches' ? canReadBoard(project, user) : canWrite(project, user))) return c.json({ detail: 'Forbidden', code: 'forbidden' }, 403);
    // A support session's token carries `impersonated_by` (as `isSupportSession` reads it).
    if (step === 'launch' && (await selectJwt(c))?.payload?.impersonated_by) {
      return c.json({ detail: 'A support session cannot open Lovable for the founder. Nothing was opened.', code: 'support_session_refused' }, 403);
    }
    c.header('Cache-Control', 'private, no-store');
    try {
      if (step === 'draft') return c.json(await draftPrompt(c.env, cycle, projectId, (body as any).record));
      if (step === 'check') return c.json(await checkPrompt(c.env, projectId, (body as any).prompt));
      if (step === 'launch') return c.json(await launchPrompt(c.env, user, cycle, projectId, body as Record<string, unknown>));
      return c.json(await launchesOf(c.env, cycle, projectId));
    } catch (e) {
      if (e instanceof LovableError) return c.json({ detail: e.sentence, code: e.code, ...e.extra }, e.status);
      console.error('[lovable] failed', { cycle, step, error: (e as Error)?.name || 'error' });
      return c.json({ detail: 'Lovable could not be prepared just now. Nothing was opened. Try again.', code: 'lovable_unavailable' }, 503);
    }
  };
}
