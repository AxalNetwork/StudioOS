/** D1147: a preview writes no reading or score; only Keep persists the reading. */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { run as runAI } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { storedPmfInputs } from '../services/scoring/pmfStore';
import { explanationInputs, explanationPrompt, parseExplanation, PMF_EXPLAIN_PAGE, PMF_EXPLAIN_OPTIONS, PMF_EXPLAIN_SURFACE, type ExplainMode } from '../services/scoring/pmfExplain';
import { signHmac } from '../services/scoreIntegrity';
import { railFor, refuseRun } from '../util/railContext';

const jsonBody = async (c: any) => { const b = await c.req.json().catch(() => null); return b && typeof b === 'object' && !Array.isArray(b) ? b : null; };
const signature = (env: Env, payload: string) => signHmac(env, 'pmf-reading:v1:' + payload);
function same(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(a) || a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < b.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function scope(c: any) {
  let user;
  try { user = await requireAuth(c); } catch { return c.json({ detail: 'Sign in to read this plan.' }, 401); }
  // This is a founder's own evidence, never an admin bypass or a support-session AI run.
  if (user.role !== 'founder' || (await selectJwt(c))?.payload.impersonated_by) return c.json({ detail: 'This reading belongs to the venture founder.' }, 403);
  const raw = c.req.query('project') ?? '';
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) return c.json({ detail: 'Choose a venture first.' }, 400);
  const projectId = Number(raw);
  let owned;
  try { owned = await c.env.DB.prepare(`SELECT p.id FROM projects p JOIN users u ON u.founder_id = p.founder_id
    WHERE p.id = ? AND u.id = ? AND u.is_active = 1 AND p.deleted_at IS NULL`).bind(projectId, user.id).first(); }
  catch { return c.json({ detail: 'The venture is Unreadable. Try again.' }, 503); }
  if (!owned) return c.json({ detail: 'This reading belongs to the venture founder.' }, 403);
  return { user, projectId };
}
async function read(c: Context<{ Bindings: Env }>) {
    const s = await scope(c); if (s instanceof Response) return s;
    try {
      const row = await c.env.DB.prepare(`SELECT body FROM research_zone_drafts WHERE owner_user_id = ? AND surface = ?
        AND scope_key = ? AND accepted_at IS NOT NULL ORDER BY id DESC LIMIT 1`).bind(s.user.id, PMF_EXPLAIN_SURFACE, String(s.projectId)).first<{ body: string }>();
      if (!row) return c.json({ reading: null });
      const stored = JSON.parse(row.body);
      if (typeof stored.signature !== 'string' || !same(stored.signature, await signHmac(c.env, 'pmf-kept-reading:v1:' + JSON.stringify(stored.reading)))) return c.json({ detail: 'The kept reading is Unreadable. Try again.' }, 503);
      return c.json({ reading: stored.reading });
    } catch { return c.json({ detail: 'The kept reading is Unreadable. Try again.' }, 503); }
}
async function preview(c: Context<{ Bindings: Env }>, runner: typeof runAI) {
    const s = await scope(c); if (s instanceof Response) return s;
    const b = await jsonBody(c);
    if (!b || Object.keys(b).sort().join() !== 'inputs_hash,mode' || !['explain', 'questions'].includes(b.mode) || typeof b.inputs_hash !== 'string' || !/^[a-f0-9]{64}$/.test(b.inputs_hash)) return c.json({ detail: 'Choose Explain or interview questions from the current readiness inputs.' }, 400);
    const mode = b.mode as ExplainMode;
    try {
      const snapshot = await storedPmfInputs(c.env, s.projectId);
      if (!snapshot) return c.json({ detail: 'Not recorded: open the readiness inputs first.' }, 409);
      if (snapshot.hash !== b.inputs_hash) return c.json({ code: 'pmf_inputs_changed', detail: 'The displayed inputs changed. Refresh readiness before asking Eadwyn.' }, 409);
      const inputs = explanationInputs(snapshot.inputs, mode);
      if (!inputs.length) return c.json({ detail: 'Not recorded: there are no applicable inputs to read.' }, 409);
      const out = await runner(c.env, { task: 'workspace_explain', userId: s.user.id, text: explanationPrompt(inputs, mode), maxTokens: 2000,
        surface: AI_SURFACE.raiseReadiness, rail: railFor(c, { page: PMF_EXPLAIN_PAGE, option: PMF_EXPLAIN_OPTIONS[mode] }) });
      const refused = refuseRun(c, out); if (refused) return refused;
      if (!out.ok) return c.json({ detail: 'Eadwyn could not read these inputs. Try again.' }, 503);
      const items = parseExplanation(out.output, inputs);
      if (!items) return c.json({ detail: 'The reading could not be matched to its inputs. Try again.' }, 503);
      // Questions have neither a receipt nor a persistence action.
      if (mode === 'questions') return c.json({ surface: PMF_EXPLAIN_SURFACE, mode, items });
      const dollars = out.usage?.est_cost_usd;
      const cost = typeof dollars === 'number' && dollars >= 0 ? Math.round(dollars * 1e6) : null;
      if (cost === null || !Number.isSafeInteger(cost)) return c.json({ detail: 'The run receipt could not be read. Try again.' }, 503);
      const payload = JSON.stringify({ uid: crypto.randomUUID(), user: s.user.id, project: s.projectId, hash: snapshot.hash,
        expires: Date.now() + 15 * 60 * 1000, cost_micro_usd: cost, model: out.usage?.model ?? null, items: items.map(i => ({ input: i.input, text: i.text })) });
      return c.json({ surface: PMF_EXPLAIN_SURFACE, mode, items, receipt: { payload, signature: await signature(c.env, payload) } });
    } catch { return c.json({ detail: 'The readiness inputs are Unreadable. Try again.' }, 503); }
}
async function keep(c: Context<{ Bindings: Env }>) {
    const s = await scope(c); if (s instanceof Response) return s;
    const b = await jsonBody(c);
    const receipt = b?.receipt;
    if (!b || Object.keys(b).join() !== 'receipt' || !receipt || typeof receipt.payload !== 'string' || receipt.payload.length > 12000 || typeof receipt.signature !== 'string') return c.json({ detail: 'Explain the current inputs before keeping a reading.' }, 400);
    try {
      if (!same(receipt.signature, await signature(c.env, receipt.payload))) return c.json({ detail: 'The reading could not be verified.' }, 400);
      const p = JSON.parse(receipt.payload);
      if (p.user !== s.user.id || p.project !== s.projectId || !Number.isFinite(p.expires) || p.expires < Date.now()) return c.json({ detail: 'This reading has expired. Explain the inputs again.' }, 409);
      const snapshot = await storedPmfInputs(c.env, s.projectId);
      if (!snapshot || snapshot.hash !== p.hash) return c.json({ detail: 'The inputs changed. Explain them again before keeping a reading.' }, 409);
      const items = parseExplanation(JSON.stringify({ items: p.items }), explanationInputs(snapshot.inputs, 'explain'));
      if (!items) return c.json({ detail: 'The reading could not be matched to its inputs.' }, 409);
      const reading = { items, inputs_hash: snapshot.hash, snapshot: snapshot.snapshot };
      const protectedReading = JSON.stringify({ reading, signature: await signHmac(c.env, 'pmf-kept-reading:v1:' + JSON.stringify(reading)) });
      await c.env.DB.batch([
        c.env.DB.prepare(`INSERT INTO research_zone_drafts (uid, owner_user_id, surface, scope_key, body, model, cost_micro_usd, accepted_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, datetime('now') WHERE
          (SELECT inputs_hash FROM venture_scorecards WHERE project_id = ? AND scope = 'pmf' ORDER BY id DESC LIMIT 1) = ?
          ON CONFLICT(uid) DO NOTHING`).bind(p.uid, s.user.id, PMF_EXPLAIN_SURFACE, String(s.projectId), protectedReading, p.model, p.cost_micro_usd, s.projectId, snapshot.hash),
        c.env.DB.prepare(`INSERT INTO activity_logs (project_id,user_id,entity_type,entity_id,action,details,actor)
          SELECT ?,?,'raise.fundraising-readiness',?,'pmf_reading_kept',?,?
          WHERE EXISTS (SELECT 1 FROM research_zone_drafts WHERE uid = ? AND owner_user_id = ?)
          AND NOT EXISTS (SELECT 1 FROM activity_logs WHERE project_id = ? AND entity_id = ? AND action = 'pmf_reading_kept')`)
          .bind(s.projectId, s.user.id, p.uid, JSON.stringify({ surface: PMF_EXPLAIN_SURFACE, snapshot: snapshot.snapshot }), `user:${s.user.id}`, p.uid, s.user.id, s.projectId, p.uid),
      ]);
      const saved = await c.env.DB.prepare('SELECT 1 AS present FROM research_zone_drafts WHERE uid = ? AND owner_user_id = ?').bind(p.uid, s.user.id).first();
      if (!saved) return c.json({ detail: 'The inputs changed. Explain them again before keeping a reading.' }, 409);
      return c.json({ reading });
    } catch { return c.json({ detail: 'The reading could not be kept. Try again.' }, 503); }
}
export function createPmfExplainRouter(runner: typeof runAI = runAI) {
  const router = new Hono<{ Bindings: Env }>();
  router.get('/', read);
  router.post('/', c => preview(c, runner));
  router.post('/keep', keep);
  return router;
}
// Explicit mounts keep the production route visible to the API drift scanner.
const pmfExplain = new Hono<{ Bindings: Env }>();
pmfExplain.get('/', read);
pmfExplain.post('/', c => preview(c, runAI));
pmfExplain.post('/keep', keep);
export default pmfExplain;
