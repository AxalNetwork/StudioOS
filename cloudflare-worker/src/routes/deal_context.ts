/** D1150: investor's own deal progress and firm's private notes. No staff bypass. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { activeCompanyFor } from '../middleware/activeCompany';
import { receivedCommitment } from '../services/raiseCycle';

const r = new Hono<{ Bindings: Env }>();
const guard = async (c: any, next: () => Promise<void>) => {
  if ((await selectJwt(c))?.payload.impersonated_by) return c.json({ error: 'support_session_refused' }, 403);
  await requireAuth(c);
  c.header('Cache-Control', 'no-store');
  await next();
};
r.use('/:id/stage', guard);
r.use('/:id/whats-new', guard);
r.use('/:id/notes', guard);
r.use('/:id/notes/:uid', guard);

async function context(c: any) {
  const user = await requireAuth(c);
  if (user.role !== 'investor') return { error: c.json({ error: 'investor_only' }, 403) };
  const raw = c.req.param('id');
  if (!/^[1-9][0-9]{0,14}$/.test(raw)) return { error: c.json({ error: 'invalid_deal' }, 400) };
  let company = await activeCompanyFor(c, user);
  // An invalid explicit claim never falls back to another firm.
  if (c.req.header('X-Company-Id') && company == null) return { error: c.json({ error: 'firm_required' }, 403) };
  if (company == null) {
    const links = await c.env.DB.prepare('SELECT DISTINCT company_id FROM user_company_links WHERE user_id = ? LIMIT 2').bind(user.id).all();
    if (links.results.length > 1) return { error: c.json({ error: 'firm_required', message: 'Choose the firm this deal is for.' }, 409) };
    company = links.results.length ? Number(links.results[0].company_id) : null;
  }
  const id = Number(raw);
  const deal = await c.env.DB.prepare(`SELECT d.id, d.project_id, d.status, d.created_at, d.updated_at FROM deals d
    WHERE d.id = ? AND EXISTS (SELECT 1 FROM projects p WHERE p.id = d.project_id AND p.deleted_at IS NULL)
    AND (EXISTS (SELECT 1 FROM deal_invitations i WHERE i.deal_id = d.id AND i.investor_user_id = ? AND (i.company_id = ? OR i.company_id IS NULL))
      OR EXISTS (SELECT 1 FROM commitments k WHERE k.deal_id = d.id AND k.investor_user_id = ? AND (k.company_id = ? OR k.company_id IS NULL)))`)
    .bind(id, user.id, company, user.id, company).first();
  if (!deal) return { error: c.json({ error: 'deal_not_found' }, 404) };
  return { user, company, id, deal };
}

/** Only metadata from records this investor may read; never other firms' memos or bank data. */
async function facts(db: D1Database, x: any) {
  const { id, user, company, deal } = x;
  const invitation = await db.prepare(`SELECT uid, status, COALESCE(responded_at, created_at) AS at FROM deal_invitations
    WHERE deal_id = ? AND investor_user_id = ? AND (company_id = ? OR company_id IS NULL) ORDER BY id DESC LIMIT 1`).bind(id, user.id, company).first<any>();
  const member = await db.prepare(`SELECT joined_at AS at FROM investor_dealroom_members
    WHERE deal_id = ? AND investor_user_id = ? AND (company_id = ? OR company_id IS NULL) LIMIT 1`).bind(id, user.id, company).first<any>();
  const dd = await db.prepare(`SELECT d.uid, d.status, d.updated_at AS at FROM dd_cases d WHERE d.subject_type = 'project' AND d.subject_id = ?
    AND d.status != 'archived' AND (d.owner_user_id = ? OR EXISTS (SELECT 1 FROM dd_reviewers v WHERE v.case_id = d.id AND v.user_id = ?))
    ORDER BY julianday(d.updated_at) DESC, d.id DESC LIMIT 1`).bind(deal.project_id, user.id, user.id).first<any>();
  const ic = await db.prepare(`SELECT d.uid, d.status, d.decision, d.terms_json IS NOT NULL AND trim(d.terms_json) NOT IN ('','{}','null') AS terms, d.updated_at AS at
    FROM ic_decisions d WHERE d.deal_id = ? AND d.company_id IS ? AND
    (d.created_by = ? OR EXISTS (SELECT 1 FROM ic_votes v WHERE v.ic_decision_id = d.id AND v.user_id = ?)
      OR EXISTS (SELECT 1 FROM user_company_links l WHERE l.user_id = ? AND l.company_id = d.company_id))
    ORDER BY julianday(d.updated_at) DESC, d.id DESC LIMIT 1`).bind(id, company, user.id, user.id, user.id).first<any>();
  const committee = await db.prepare('SELECT 1 AS used FROM ic_decisions WHERE company_id IS ? AND (company_id IS NOT NULL OR created_by = ?) LIMIT 1').bind(company,user.id).first<any>();
  const commitment = await db.prepare(`SELECT id, status, created_at AS at FROM commitments WHERE deal_id = ? AND investor_user_id = ? AND (company_id = ? OR company_id IS NULL)
    AND status IN ('pending','confirmed') ORDER BY id DESC LIMIT 1`).bind(id, user.id, company).first<any>();
  const envelope = await db.prepare(`SELECT e.envelope_uuid AS uid, CASE WHEN EXISTS (SELECT 1 FROM esign_recipients mine WHERE mine.envelope_id = e.id AND mine.user_id = ? AND mine.status = 'signed') THEN 'completed' ELSE e.status END AS status, COALESCE(e.completed_at,e.created_at) AS at FROM esign_envelopes e
    WHERE e.deal_id = ? AND (e.user_id = ? OR EXISTS (SELECT 1 FROM esign_recipients p WHERE p.envelope_id = e.id AND p.user_id = ?))
    AND e.document_type IN ('safe','spa','subscription') AND e.status IN ('sent','partially_signed','completed') ORDER BY e.id DESC LIMIT 1`).bind(user.id, id, user.id, user.id).first<any>();
  const funded = commitment ? await receivedCommitment({ DB: db }, user, company, commitment.id) : null;
  return { invitation, member, dd, ic, committee, commitment, envelope, funded };
}

r.get('/:id/stage', async c => {
  try {
    const x = await context(c); if ('error' in x) return x.error;
    const f = await facts(c.env.DB, x);
    const base = `/deals/${x.id}`;
    let stage: string | null = f.invitation ? 'Invited' : null, next = { label: f.invitation ? 'I’m interested' : 'View deal', href: `${base}/overview` };
    if (f.member || f.invitation?.status === 'interested') { stage = 'Reviewing'; next = { label: 'Ask for data room access', href: `${base}/documents` }; }
    if (f.dd) { stage = 'Diligence'; next = { label: 'Open the diligence case', href: `/due-diligence/${encodeURIComponent(f.dd.uid)}` }; }
    if (f.ic) { stage = 'IC'; next = { label: 'Open IC record', href: `/ic/${encodeURIComponent(f.ic.uid)}` }; }
    if (f.ic?.terms || f.envelope) { stage = 'Terms'; next = { label: 'Review terms', href: `${base}/terms` }; }
    if (f.commitment) { stage = 'Committed'; next = { label: 'Review signing', href: `${base}/commitment` }; }
    if (f.envelope?.status === 'completed') { stage = 'Signed'; next = { label: 'Review funding', href: `${base}/commitment` }; }
    if (f.funded) { stage = 'Funded'; next = { label: 'View company reports', href: '/portfolio/updates' }; }
    if (x.deal.status === 'rejected') { stage = 'Passed by the studio'; next = { label: 'View deal', href: `${base}/overview` }; }
    if (f.invitation?.status === 'passed' || f.ic?.decision === 'pass') { stage = 'You passed'; next = { label: 'View deal', href: `${base}/overview` }; }
    return c.json({ my_stage: stage, reason: stage === null ? 'No current invitation or progress fact is recorded.' : null, next_action: { ...next, kind: stage === 'Invited' ? 'respond_interest' : 'navigate', ...(stage === 'Invited' ? { invitation_uid: f.invitation.uid } : {}) }, ic: f.committee ? { state: 'used' } : { state: 'not_used', label: 'Not used', reason: 'No IC record is recorded for this firm.' } });
  } catch { return c.json({ error: 'stage_unreadable', message: 'Deal progress is unreadable. Try again.' }, 503); }
});

r.get('/:id/whats-new', async c => {
  try {
    const clock = await c.env.DB.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS at").first<{ at: string }>();
    const at = clock!.at;
    const x = await context(c); if ('error' in x) return x.error;
    const expected = await c.env.DB.prepare('SELECT source_snapshot_json FROM deal_seen WHERE deal_id = ? AND user_id = ? AND company_id IS ?').bind(x.id,x.user.id,x.company).first<{source_snapshot_json:string}>();
    const f = await facts(c.env.DB, x);
    const documents = await c.env.DB.prepare('SELECT id, created_at AS at FROM documents WHERE project_id = ? ORDER BY id DESC').bind(x.deal.project_id).all<{ id: number; at: string }>();
    const notes = await c.env.DB.prepare(`SELECT id, updated_at AS at FROM deal_notes WHERE deal_id = ? AND company_id IS ?
      AND (company_id IS NOT NULL OR author_user_id = ?)`).bind(x.id,x.company,x.user.id).all<{id:number;at:string}>();
    const others = await c.env.DB.prepare(`SELECT id, created_at AS at FROM commitments WHERE deal_id = ? AND investor_user_id != ? AND status IN ('pending','confirmed')`).bind(x.id,x.user.id).all<{id:number;at:string}>();
    const answers = await c.env.DB.prepare(`SELECT q.id, q.responded_at AS at FROM dd_requests q JOIN dd_cases d ON d.id = q.case_id
      WHERE d.subject_type = 'project' AND d.subject_id = ? AND q.responded_at IS NOT NULL AND
      (d.owner_user_id = ? OR EXISTS (SELECT 1 FROM dd_reviewers v WHERE v.case_id = d.id AND v.user_id = ?))`).bind(x.deal.project_id,x.user.id,x.user.id).all<{id:number;at:string}>();
    const sources = [
      { type: 'deal', ref: x.id, version: x.deal.status, at: x.deal.updated_at || x.deal.created_at },
      ...(documents.results || []).map(d => ({ type: 'document', ref: d.id, version: '', at: d.at })),
      ...(notes.results || []).map(d => ({ type: 'firm_note', ref: d.id, version: '', at: d.at })),
      ...(others.results || []).map(d => ({ type: 'investor_commitment', ref: d.id, version: '', at: d.at })),
      ...(answers.results || []).map(d => ({ type: 'diligence_answer', ref: d.id, version: '', at: d.at })),
      ...['invitation','member','dd','ic','commitment','envelope','funded'].flatMap(type => {
        const fact = f[type as keyof typeof f]; return fact?.at ? [{ type, ref: fact.uid ?? fact.id ?? type, version: JSON.stringify(fact), at: fact.at }] : [];
      }),
    ];
    const snapshot = Object.fromEntries(sources.map(s => [`${s.type}:${s.ref}`, `${s.at}:${s.version}`]));
    // Read the previous watermark and advance it in one transaction. Two visits
    // cannot both consume the same previous watermark. Failed reads never advance it.
    const results = await c.env.DB.batch([
      c.env.DB.prepare('SELECT last_seen_at, source_snapshot_json FROM deal_seen WHERE deal_id = ? AND user_id = ? AND company_id IS ?').bind(x.id, x.user.id, x.company),
      c.env.DB.prepare(`INSERT INTO deal_seen (deal_id,user_id,company_id,last_seen_at,source_snapshot_json) VALUES (?,?,?,?,?)
        ON CONFLICT DO UPDATE SET last_seen_at = MAX(deal_seen.last_seen_at,excluded.last_seen_at), updated_at = excluded.last_seen_at, source_snapshot_json = excluded.source_snapshot_json
        WHERE deal_seen.source_snapshot_json IS ? AND excluded.last_seen_at >= deal_seen.last_seen_at`).bind(x.id,x.user.id,x.company,at,JSON.stringify(snapshot),expected?.source_snapshot_json ?? null),
    ]);
    const previous = results[0].results[0] as any;
    const since = previous?.last_seen_at ?? null;
    const old = previous ? JSON.parse(previous.source_snapshot_json) : {};
    const consumed = Number(results[1].meta.changes) > 0;
    const changes = previous && consumed ? sources.filter(s => old[`${s.type}:${s.ref}`] !== snapshot[`${s.type}:${s.ref}`]).map(({ type, at }) => ({ type, at })) : [];
    return c.json({ unavailable: [{ type: 'deck', reason: 'Deck versions use share-token access; this read has no caller-specific deck grant.' }], since, seen_at: at, first_visit: since === null, changes, coverage: 'Latest stored change in each accessible source and document catalog additions, firm notes, anonymous commitments and accessible diligence answers. A first visit establishes the baseline; historical intermediate changes are not reconstructed.' });
  } catch { return c.json({ error: 'changes_unreadable', message: 'Changes are unreadable. Try again.' }, 503); }
});

r.get('/:id/notes', async c => {
  try {
    const x = await context(c); if ('error' in x) return x.error;
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 25));
    const offset = Math.max(0, Number(c.req.query('offset')) || 0);
    if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(offset)) return c.json({error:'invalid_page'},400);
    const rows = await c.env.DB.prepare(`SELECT uid, author_user_id, company_id, tag, body, created_at, updated_at FROM deal_notes
      WHERE deal_id = ? AND company_id IS ? AND (company_id IS NOT NULL OR author_user_id = ?) ORDER BY id DESC LIMIT ? OFFSET ?`).bind(x.id,x.company,x.user.id,limit,offset).all();
    const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM deal_notes WHERE deal_id = ? AND company_id IS ? AND (company_id IS NOT NULL OR author_user_id = ?)').bind(x.id,x.company,x.user.id).first<{n:number}>();
    return c.json({ items: rows.results, total: count!.n });
  } catch { return c.json({ error: 'notes_unreadable', message: 'Notes are unreadable. Try again.' },503); }
});

function noteInput(b: any) {
  return b && typeof b.body === 'string' && b.body.trim().length > 0 && b.body.length <= 10000 && typeof (b.tag ?? '') === 'string' && (b.tag ?? '').length <= 80
    ? { body: b.body.trim(), tag: (b.tag ?? '').trim() } : null;
}
function audit(db: D1Database, x: any, action: string, uid: string) {
  return db.prepare(`INSERT INTO activity_logs (action, details, user_id, entity_type, entity_id) SELECT ?,?,?,'deal',? WHERE changes() > 0`)
    .bind(action, JSON.stringify({ note_uid: uid, company_id: x.company }),x.user.id,String(x.id));
}
r.post('/:id/notes', async c => {
  try {
    const x = await context(c); if ('error' in x) return x.error;
    const b = noteInput(await c.req.json().catch(() => null)); if (!b) return c.json({error:'invalid_note'},400);
    const uid = crypto.randomUUID();
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO deal_notes (uid,deal_id,author_user_id,company_id,tag,body) VALUES (?,?,?,?,?,?)').bind(uid,x.id,x.user.id,x.company,b.tag,b.body),
      audit(c.env.DB,x,'deal_note_added',uid),
    ]);
    return c.json({uid},201);
  } catch { return c.json({error:'note_write_failed',message:'The note could not be saved. Try again.'},503); }
});
function changeNote(method: 'put' | 'delete') {
  return async (c: any) => {
    try {
      const x = await context(c); if ('error' in x) return x.error;
      const uid = c.req.param('uid');
      if (!/^[a-zA-Z0-9-]{1,64}$/.test(uid)) return c.json({error:'note_not_found'},404);
      // Firm colleagues may read, but only the author can change or delete a note.
      const note = await c.env.DB.prepare('SELECT id FROM deal_notes WHERE uid = ? AND deal_id = ? AND company_id IS ? AND author_user_id = ?')
        .bind(uid,x.id,x.company,x.user.id).first();
      if (!note) return c.json({error:'note_not_found'},404);
      const b = method === 'put' ? noteInput(await c.req.json().catch(() => null)) : null;
      if (method === 'put' && !b) return c.json({error:'invalid_note'},400);
      const stmt = method === 'put'
        ? c.env.DB.prepare("UPDATE deal_notes SET body = ?, tag = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE uid = ? AND deal_id = ? AND company_id IS ? AND author_user_id = ?").bind(b!.body,b!.tag,uid,x.id,x.company,x.user.id)
        : c.env.DB.prepare('DELETE FROM deal_notes WHERE uid = ? AND deal_id = ? AND company_id IS ? AND author_user_id = ?').bind(uid,x.id,x.company,x.user.id);
      const changed = await c.env.DB.batch([stmt,audit(c.env.DB,x,method === 'put' ? 'deal_note_edited':'deal_note_deleted',uid)]);
      if (Number(changed[0].meta.changes) === 0) return c.json({error:'note_not_found'},404);
      return c.json({ok:true});
    } catch { return c.json({error:'note_write_failed',message:'The note could not be changed. Try again.'},503); }
  };
}
r.put('/:id/notes/:uid', changeNote('put'));
r.delete('/:id/notes/:uid', changeNote('delete'));
export default r;
