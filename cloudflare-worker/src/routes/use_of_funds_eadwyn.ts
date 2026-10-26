/** D1179: preview and Keep only. No scenario, milestone or forecast writer. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { activeCompanyFor } from '../middleware/activeCompany';
import { projectInActiveCompany } from '../services/tenancyScope';
import { isSupportSession } from '../integrations/providers/mercury';
import { run as runAI } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { readingMaterial, readingPrompt, parseReading, UOF_OPTIONS, UOF_PAGE, type ReadingMode } from '../services/useOfFunds/eadwyn';
import type { Scope } from '../services/useOfFunds/store';
import { signHmac } from '../services/scoreIntegrity';
import { railFor, refuseRun } from '../util/railContext';
import { refuse } from '../util/refusal';

type Bindings = { Bindings: Env; Variables: { readingScope: Scope } };
const failure = (c: any, code = 'uof_reading_unreadable', status = 503) => refuse(c, status, { code, message: 'This reading is Unreadable. Try again.' });
const validId = (n: unknown) => /^[1-9][0-9]{0,9}$/.test(String(n ?? ''));
const sign = (env: Env, payload: string) => signHmac(env, 'uof-reading:v1:' + payload);
const same = (a: unknown, b: string) => {
  if (typeof a !== 'string' || !/^[a-f0-9]{64}$/.test(a) || a.length !== b.length) return false;
  let diff = 0; for (let n = 0; n < b.length; n++) diff |= a.charCodeAt(n) ^ b.charCodeAt(n);
  return diff === 0;
};
export function createUseOfFundsEadwyn(runner: typeof runAI = runAI) {
  const r = new Hono<Bindings>();
  r.use('*', async (c, next) => {
    let user; try { user = await requireAuth(c as any); } catch { return refuse(c, 401, { code: 'unauthorized', message: 'Sign in first.' }); }
    if (user.role !== 'founder' || await isSupportSession(c as any)) return refuse(c, 403, { code: 'founder_only', message: 'Eadwyn reads this plan for its founder.' });
    if (!validId(c.req.query('project'))) return refuse(c, 400, { code: 'project_required', message: 'Choose a venture first.' });
    const projectId = Number(c.req.query('project'));
    try {
      const project = await c.env.DB.prepare('SELECT id, founder_id, company_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(projectId).first<any>();
      const company = await activeCompanyFor(c as any, user);
      if (!project || Number(project.founder_id) !== Number(user.founder_id) || !projectInActiveCompany(company, project)) return refuse(c, 404, { code: 'not_found', message: 'Venture not found.' });
      c.set('readingScope', { projectId, user, founderUserId: user.id, readOnly: true });
      c.header('Cache-Control', 'private, no-store');
      await next();
    } catch { return failure(c); }
  });
  r.onError((_e, c) => failure(c));
  r.get('/roadmap', async c => {
    const s = c.get('readingScope');
    const rows = await c.env.DB.prepare('SELECT id, objective FROM roadmap_okrs WHERE project_id = ? ORDER BY sort_order, id').bind(s.projectId).all<{ id: number; objective: string }>();
    if (!rows.success || !Array.isArray(rows.results)) return failure(c);
    return c.json({ items: rows.results });
  });
  r.get('/', async c => {
    const s = c.get('readingScope');
    const rows = await c.env.DB.prepare(`SELECT body FROM research_zone_drafts WHERE owner_user_id = ? AND scope_key = ?
      AND surface IN ('raise/use-of-funds-check','raise/use-of-funds-runway') AND accepted_at IS NOT NULL ORDER BY id DESC LIMIT 20`)
      .bind(s.user.id, String(s.projectId)).all<{ body: string }>();
    if (!rows.success || !Array.isArray(rows.results)) return failure(c);
    const items = [];
    for (const row of rows.results) {
      const kept = JSON.parse(row.body);
      if (!kept || typeof kept.payload !== 'string' || !same(kept.signature, await sign(c.env, kept.payload))) return failure(c);
      const p = JSON.parse(kept.payload);
      if (p.user !== s.user.id || p.project !== s.projectId || !['check','runway'].includes(p.mode)) return failure(c);
      items.push(p);
    }
    return c.json({ items });
  });
  r.post('/', async c => {
    const s = c.get('readingScope');
    const b = await c.req.json().catch(() => null);
    if (!b || !Object.hasOwn(UOF_OPTIONS, b.mode) || Object.keys(b).some(k => !['mode', 'okr_id'].includes(k)) || (b.mode === 'wording' ? !validId(b.okr_id) : b.okr_id !== undefined)) return refuse(c, 400, { code: 'invalid_reading', message: 'Choose the reading and its recorded source.' });
    const mode = b.mode as ReadingMode;
    const material = await readingMaterial(c.env, s, mode, b.okr_id == null ? undefined : Number(b.okr_id));
    if (material.sources.length < (mode === 'check' ? 2 : 1) || (mode !== 'wording' && !material.sources.some(x => x.ref === 'plan')) || (mode === 'runway' && !material.sources.some(x => x.ref === 'cash-path')))
      return c.json({ code: 'sources_not_recorded', message: 'Not enough recorded sources for this reading.', gaps: material.gaps }, 409);
    let out;
    try { out = await runner(c.env, { task: 'workspace_explain', userId: s.user.id, text: readingPrompt(material, mode), maxTokens: 2400,
      surface: AI_SURFACE.raiseUseOfFunds, rail: railFor(c, { page: UOF_PAGE, option: UOF_OPTIONS[mode] }) }); }
    catch { return failure(c); }
    // Provider errors and model text never become an error response.
    const refused = refuseRun(c, { refusal: out.refusal }); if (refused) return refused;
    if (!out.ok) return failure(c);
    const items = parseReading(out.output, material, mode);
    if (!items) return failure(c, 'uof_reading_ungrounded');
    const cost = out.usage?.est_cost_usd;
    const costMicro = typeof cost === 'number' && cost >= 0 ? Math.round(cost * 1e6) : null;
    if (costMicro === null || !Number.isSafeInteger(costMicro)) return failure(c);
    const source_refs = material.sources.map(({ ref, label, source, href, as_of }) => ({ ref, label, source, href, as_of }));
    const reading = { mode, items, source_refs, gaps: material.gaps, captured_at: new Date().toISOString(), cost_micro_usd: costMicro };
    if (mode === 'wording') return c.json({ reading }); // Accept places the name in the unsaved form only.
    const payload = JSON.stringify({ ...reading, uid: crypto.randomUUID(), user: s.user.id, project: s.projectId, expires: Date.now() + 15 * 60 * 1000 });
    return c.json({ reading, receipt: { payload, signature: await sign(c.env, payload) } });
  });
  r.post('/keep', async c => {
    const s = c.get('readingScope');
    const b = await c.req.json().catch(() => null), receipt = b?.receipt;
    if (!b || Object.keys(b).join() !== 'receipt' || !receipt || typeof receipt.payload !== 'string' || receipt.payload.length > 140000 || !same(receipt.signature, await sign(c.env, receipt.payload))) return refuse(c, 400, { code: 'invalid_reading', message: 'Run a reading before keeping it.' });
    const p = JSON.parse(receipt.payload);
    if (p.user !== s.user.id || p.project !== s.projectId || !['check', 'runway'].includes(p.mode) || !Number.isFinite(p.expires) || p.expires < Date.now()) return refuse(c, 409, { code: 'reading_expired', message: 'Run a fresh reading before keeping it.' });
    const body = JSON.stringify(receipt), surface = p.mode === 'check' ? 'raise/use-of-funds-check' : 'raise/use-of-funds-runway';
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO research_zone_drafts (uid, owner_user_id, surface, scope_key, body, cost_micro_usd, accepted_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(uid) DO NOTHING`).bind(p.uid, s.user.id, surface, String(s.projectId), body, p.cost_micro_usd),
      c.env.DB.prepare(`INSERT INTO activity_logs (project_id,user_id,entity_type,entity_id,action,details,actor)
        SELECT ?,?,'raise.use-of-funds',?,'eadwyn_reading_kept','A sourced plan reading was kept.',?
        WHERE EXISTS (SELECT 1 FROM research_zone_drafts WHERE uid = ? AND owner_user_id = ? AND surface = ? AND scope_key = ?)
        AND NOT EXISTS (SELECT 1 FROM activity_logs WHERE project_id = ? AND entity_id = ? AND action = 'eadwyn_reading_kept')`)
        .bind(s.projectId,s.user.id,p.uid,`user:${s.user.id}`,p.uid,s.user.id,surface,String(s.projectId),s.projectId,p.uid),
    ]);
    return c.json({ reading: p });
  });
  return r;
}
const useOfFundsEadwyn = createUseOfFundsEadwyn();
export default useOfFundsEadwyn;
