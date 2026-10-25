/**
 * D1019 (#2856) — Cap table: who sees what. Mounted at /api/captable/access,
 * before the /api/captable router (whose `/:projectId` would take "access").
 *
 *   GET    /log                               Super Admin: the access log across companies
 *   GET    /shared/:token                     PUBLIC: a venture share link, at its level
 *   GET    /:projectId                        the caller's view at their level; logged
 *   POST   /:projectId/support                an admin's support read: { reason }; Full, read only; logged with the reason
 *   GET    /:projectId/grants                 owner and co-founders: who sees what
 *   PUT    /:projectId/grants                 owner: { user_uid?, holder_ref?, level?, from_envelope? }
 *   DELETE /:projectId/grants/:id             owner: revoke
 *   GET    /:projectId/log                    owner and co-founders: who opened it, when, at which level
 *   GET    /:projectId/links                  owner and co-founders: the venture's share links
 *   POST   /:projectId/links                  owner: { level, label?, expires_in_hours?, view_limit?, holders_agreed? }
 *   DELETE /:projectId/links/:id              owner: revoke
 *
 * `services/captableAccess.ts` says who reads at which level, and
 * `services/captableShare.ts` what each level returns. Every view is built
 * from the venture's saved model, the only cap table on file until part 2's
 * record (D1015 §3), and says so (`source: 'model'`).
 *
 * EVERY OPEN IS LOGGED, OR THE READ IS REFUSED. A view is returned only after
 * its log row is written; a log that cannot be written is a 503. No IP address
 * is kept.
 *
 * GRANTS, REVOKES AND LINKS ARE THE OWNER'S ONLY, each with one audit row in
 * `activity_logs`. A co-founder reads who sees what, and changes nothing.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAuth, isSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { mapError } from './_t13t14t15_helpers';
import { NOT_SHARED, resolveAccess, type AccessVia } from '../services/captableAccess';
import {
  ATTESTED_LEVELS, LEVEL_SCOPE, LINK_LEVELS, isAccessLevel, ownPositionView, redactForAudience,
  type AccessLevel, type ShareAudience,
} from '../services/captableShare';
import { claimShareToken, mintShareToken, sha256Hex, verifyShareToken } from '../services/shareLink';

const r = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;

/** The words every view carries until part 2's record exists. */
export const MODEL_SOURCE_NOTE =
  'These figures come from the venture\'s saved model, not from a record of what was issued.';
export const SIDE_LETTER_TEMPLATE = 'pro_rata_information_rights_side_letter';
export const SUPPORT_REASON_MIN = 10;
const REASON_MAX = 500;
const LINK_TTL_HOURS = { default: 168, max: 24 * 90 };
const LINK_VIEWS = { default: 25, max: 500 };

class Refusal extends Error {
  status: 400 | 403 | 404 | 409 | 410 | 503;
  code: string;
  sentence: string;
  constructor(status: Refusal['status'], code: string, sentence: string) {
    super(sentence);
    this.status = status;
    this.code = code;
    this.sentence = sentence;
  }
}

function answer(c: C, e: unknown) {
  if (e instanceof Refusal) return refuse(c, e.status, { code: e.code, message: e.sentence, extra: { code: e.code } });
  return mapError(c, e);
}

type Project = { id: number; founder_id: number | null; name: string | null };

async function projectOr404(c: C): Promise<Project> {
  const id = Number(c.req.param('projectId'));
  if (!Number.isInteger(id) || id <= 0) throw new Refusal(404, 'not_a_venture', 'No venture has that id.');
  const p = await c.env.DB.prepare('SELECT id, founder_id, name FROM projects WHERE id = ?').bind(id).first<Project>();
  if (!p) throw new Refusal(404, 'not_a_venture', 'No venture has that id.');
  return p;
}

type Model = { name: string; inputs: any; result: any } | null;

/** The venture's saved model (its canonical scenario), or null when none is saved. A failed read throws. */
async function loadModel(env: Env, projectId: number): Promise<Model> {
  const row = await env.DB.prepare(
    'SELECT name, inputs_json, result_json FROM cap_table_scenarios WHERE project_id = ? AND COALESCE(is_variant, 0) = 0 ORDER BY updated_at DESC LIMIT 1',
  ).bind(projectId).first<{ name: string | null; inputs_json: string | null; result_json: string | null }>();
  if (!row) return null;
  const parse = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
  return { name: row.name || 'Cap table', inputs: parse(row.inputs_json), result: parse(row.result_json) };
}

/** The SAFEs sent through StudioOS in a holder's name: the documents Own position lists. */
async function holderDocuments(env: Env, projectId: number, holderRef: string) {
  const rows = await env.DB.prepare(
    `SELECT COALESCE(e.document_title, 'SAFE') AS title, e.status AS status
       FROM safe_issuances s LEFT JOIN esign_envelopes e ON e.id = s.envelope_id
      WHERE s.project_id = ? AND lower(trim(s.investor_name)) = lower(trim(?)) ORDER BY s.id`,
  ).bind(projectId, holderRef).all<{ title: string; status: string | null }>();
  return rows.results || [];
}

/** What `level` shows of the model. Copy-built, so a field the level may not see is never in it. */
async function viewAt(env: Env, projectId: number, level: Exclude<AccessLevel, 'none'>, holderRef: string | null, model: Model) {
  if (!model) return { recorded: false as const, reason: 'No cap table is saved for this venture yet.' };
  if (level === 'own_position') {
    return ownPositionView(model.result, model.inputs, holderRef ?? '', holderRef ? await holderDocuments(env, projectId, holderRef) : []);
  }
  return redactForAudience(model.result, level, model.name);
}

async function logOpen(env: Env, row: {
  project_id: number; user_id: number | null; share_token_id?: number | null; via: AccessVia; level: string; reason?: string | null;
}) {
  try {
    await env.DB.prepare(
      'INSERT INTO cap_table_access_log (project_id, user_id, share_token_id, via, level, reason) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(row.project_id, row.user_id, row.share_token_id ?? null, row.via, row.level, row.reason ?? null).run();
  } catch (e) {
    console.error('[captable-access] log', (e as Error)?.message);
    throw new Refusal(503, 'access_log_unwritable', 'This open could not be logged, so the cap table is not shown. Try again.');
  }
}

const auditStmt = (env: Env, projectId: number, userId: number, action: string, details: Record<string, unknown>) =>
  env.DB.prepare('INSERT INTO activity_logs (project_id, user_id, action, details, actor) VALUES (?, ?, ?, ?, ?)')
    .bind(projectId, userId, action, JSON.stringify(details), `user:${userId}`);

async function audit(env: Env, projectId: number, userId: number, action: string, details: Record<string, unknown>) {
  await auditStmt(env, projectId, userId, action, details).run();
}

/** The owner, or a 403 that says only the owner changes who sees what. */
async function ownerOf(c: C, user: any, p: Project) {
  const a = await resolveAccess(c.env, user, p);
  if (!a.ok || !a.owner) throw new Refusal(403, 'owner_only', 'Only the venture\'s owner changes who sees its cap table.');
  return a;
}

/** The owner or an accepted co-founder, who read who sees what. */
async function teamOf(c: C, user: any, p: Project) {
  const a = await resolveAccess(c.env, user, p);
  if (!a.ok || !(a.owner || a.cofounder)) throw new Refusal(403, 'team_only', 'Only the venture\'s founders read who sees its cap table.');
  return a;
}

const page = (c: C) => {
  const lim = c.req.query('limit');
  const before = c.req.query('before');
  if ((lim && !/^\d{1,3}$/.test(lim)) || (before && !/^\d{1,12}$/.test(before))) {
    throw new Refusal(400, 'bad_page', 'limit is 1 to 100, and before a log row id.');
  }
  const limit = lim ? Number(lim) : 50;
  if (limit < 1 || limit > 100) throw new Refusal(400, 'bad_page', 'limit is 1 to 100, and before a log row id.');
  return { limit, before: before ? Number(before) : Number.MAX_SAFE_INTEGER };
};

// ---------------------------------------------------------------------------
// Routes without a venture id first, so `/log` and `/shared/…` never read as one.
// ---------------------------------------------------------------------------

/** The Super Admin reads the access log across companies. Names, never an IP. */
r.get('/log', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!isSuperAdmin(user as any)) throw new Refusal(403, 'hq_only', 'The access log across companies is for HQ.');
    const pg = page(c);
    const rows = await c.env.DB.prepare(
      `SELECT l.id, l.project_id, p.name AS venture, l.via, l.level, l.reason, l.opened_at,
              COALESCE(u.name, CASE WHEN l.share_token_id IS NOT NULL THEN 'A share link' END) AS who
         FROM cap_table_access_log l LEFT JOIN projects p ON p.id = l.project_id LEFT JOIN users u ON u.id = l.user_id
        WHERE l.id < ? ORDER BY l.id DESC LIMIT ?`,
    ).bind(pg.before, pg.limit + 1).all<Record<string, unknown>>();
    const items = (rows.results || []).slice(0, pg.limit);
    return c.json({ items, next_before: (rows.results || []).length > pg.limit ? items[items.length - 1].id : null });
  } catch (e) {
    return answer(c, e);
  }
});

/** PUBLIC. A venture link: the model at the link's level, read when opened, and logged. */
r.get('/shared/:token', async (c) => {
  try {
    const token = c.req.param('token');
    const verified = await verifyShareToken(c.env, token);
    if ('error' in verified) {
      throw verified.error === 'expired'
        ? new Refusal(410, 'link_expired', 'This link has expired. Ask for a fresh one.')
        : new Refusal(403, 'link_invalid', 'This link is not valid.');
    }
    const m = /^captable-venture:(\d+):(summary|investor|full):[0-9a-f]{32}$/.exec(String(verified.k));
    if (!m) throw new Refusal(403, 'link_invalid', 'This link is not valid.');
    const projectId = Number(m[1]);
    const level = m[2] as ShareAudience;
    const hash = await sha256Hex(token);
    const claim = await claimShareToken(c.env, 'captable_share_tokens', hash);
    if (!claim.ok) {
      throw claim.reason === 'exhausted_or_expired'
        ? new Refusal(410, 'link_spent', 'This link has been used its maximum number of times, or has expired.')
        : new Refusal(403, 'link_invalid', 'This link is not valid.');
    }
    const tok = await c.env.DB.prepare(
      'SELECT id, project_id, level, revoked_at FROM captable_share_tokens WHERE token_hash = ? LIMIT 1',
    ).bind(hash).first<{ id: number; project_id: number | null; level: string | null; revoked_at: string | null }>();
    // The signed claim and the stored row must agree on the venture and the level.
    if (!tok || tok.revoked_at || Number(tok.project_id) !== projectId || tok.level !== level) {
      throw new Refusal(403, 'link_invalid', 'This link is not valid.');
    }
    const model = await loadModel(c.env, projectId);
    await logOpen(c.env, { project_id: projectId, user_id: null, share_token_id: tok.id, via: 'link', level });
    return c.json({ level, scope: LEVEL_SCOPE[level], source: 'model', source_note: MODEL_SOURCE_NOTE, view: await viewAt(c.env, projectId, level, null, model) });
  } catch (e) {
    return answer(c, e);
  }
});

// ---------------------------------------------------------------------------
// One venture.
// ---------------------------------------------------------------------------

r.get('/:projectId', async (c) => {
  try {
    const user = await requireAuth(c);
    const p = await projectOr404(c);
    const a = await resolveAccess(c.env, user as any, p);
    if (!a.ok) throw new Refusal(a.status, a.code, NOT_SHARED);
    const model = await loadModel(c.env, p.id);
    await logOpen(c.env, { project_id: p.id, user_id: user.id, via: a.via, level: a.level });
    return c.json({
      project_id: p.id, level: a.level, via: a.via, read_only: a.read_only, scope: LEVEL_SCOPE[a.level],
      source: 'model', source_note: MODEL_SOURCE_NOTE,
      ...(a.via === 'studio' ? { support: 'Open for support asks for a reason first. The founder sees it.' } : {}),
      view: await viewAt(c.env, p.id, a.level, a.holder_ref, model),
    });
  } catch (e) {
    return answer(c, e);
  }
});

/** CT18: an admin opens the full table for support, with a reason the founder sees. Read only. */
r.post('/:projectId/support', async (c) => {
  try {
    const user = await requireAuth(c);
    if (String(user.role ?? '').toLowerCase() !== 'admin') throw new Refusal(403, 'admins_only', 'Only an admin opens a cap table for support.');
    const p = await projectOr404(c);
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < SUPPORT_REASON_MIN || reason.length > REASON_MAX) {
      throw new Refusal(400, 'reason_required', `Say why you are opening it, in ${SUPPORT_REASON_MIN} to ${REASON_MAX} characters. The founder sees it.`);
    }
    const model = await loadModel(c.env, p.id);
    await logOpen(c.env, { project_id: p.id, user_id: user.id, via: 'support', level: 'full', reason });
    return c.json({
      project_id: p.id, level: 'full', via: 'support', read_only: true, scope: LEVEL_SCOPE.full, reason,
      source: 'model', source_note: MODEL_SOURCE_NOTE,
      corrections: 'A correction goes through the record\'s correction, with its reason (Cap table part 2).',
      view: await viewAt(c.env, p.id, 'full', null, model),
    });
  } catch (e) {
    return answer(c, e);
  }
});

r.get('/:projectId/grants', async (c) => {
  try {
    const user = await requireAuth(c);
    const p = await projectOr404(c);
    const me = await teamOf(c, user, p);
    const rows = await c.env.DB.prepare(
      `SELECT g.id, u.uid AS user_uid, u.name AS name, u.role AS role, g.holder_ref, g.level, g.source, g.since,
              gb.name AS granted_by,
              (SELECT MAX(l.opened_at) FROM cap_table_access_log l WHERE l.project_id = g.project_id AND l.user_id = g.user_id) AS last_viewed
         FROM cap_table_access_grants g LEFT JOIN users u ON u.id = g.user_id LEFT JOIN users gb ON gb.id = g.granted_by
        WHERE g.project_id = ? AND g.revoked_at IS NULL ORDER BY g.since DESC, g.id DESC`,
    ).bind(p.id).all<Record<string, unknown>>();
    return c.json({ grants: rows.results || [], can_change: me.owner, levels: LEVEL_SCOPE });
  } catch (e) {
    return answer(c, e);
  }
});

/**
 * The owner grants a level. From a signed information-rights side letter, the
 * grant is prefilled: the letter's signing investor at Investor, unless the
 * owner names another level. A changed level revokes the live row and inserts
 * a new one in one batch, so who could see what stays on file.
 */
r.put('/:projectId/grants', async (c) => {
  try {
    const user = await requireAuth(c);
    const p = await projectOr404(c);
    await ownerOf(c, user, p);
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    let target: { id: number; role: string | null } | null = null;
    let source: 'founder' | 'side_letter' = 'founder';
    let sourceRef: string | null = null;
    if (body.level !== undefined && !isAccessLevel(body.level)) {
      throw new Refusal(400, 'bad_level', 'level is none, own_position, summary, investor or full.');
    }
    let level: AccessLevel | null = body.level === undefined ? null : body.level as AccessLevel;

    if (typeof body.from_envelope === 'string' && body.from_envelope) {
      // A completed side letter of this venture's deal, and the investor who signed it.
      const env1 = await c.env.DB.prepare(
        `SELECT e.id, e.envelope_uuid FROM esign_envelopes e JOIN deals d ON d.id = e.deal_id
          WHERE e.envelope_uuid = ? AND e.document_type = ? AND e.status = 'completed' AND d.project_id = ?`,
      ).bind(body.from_envelope, SIDE_LETTER_TEMPLATE, p.id).first<{ id: number; envelope_uuid: string }>();
      if (!env1) throw new Refusal(400, 'not_a_signed_side_letter', 'That is not a signed information-rights side letter for this venture.');
      const signer = await c.env.DB.prepare(
        `SELECT u.id, u.role FROM esign_recipients r JOIN users u ON u.id = r.user_id
          WHERE r.envelope_id = ? AND r.status = 'signed' AND lower(u.role) = 'investor' ORDER BY r.id LIMIT 1`,
      ).bind(env1.id).first<{ id: number; role: string | null }>();
      if (!signer) throw new Refusal(400, 'not_a_signed_side_letter', 'No investor has signed that side letter.');
      target = signer;
      source = 'side_letter';
      sourceRef = env1.envelope_uuid;
      level = level ?? 'investor';
    } else if (typeof body.user_uid === 'string' && body.user_uid) {
      target = await c.env.DB.prepare('SELECT id, role FROM users WHERE uid = ?').bind(body.user_uid).first<{ id: number; role: string | null }>();
      if (!target) throw new Refusal(404, 'no_such_user', 'No account has that uid.');
    }
    const holderRef = typeof body.holder_ref === 'string' && body.holder_ref.trim() ? body.holder_ref.trim().slice(0, 200) : null;
    if (!target && !holderRef) throw new Refusal(400, 'no_grantee', 'Name the person (user_uid), the holder (holder_ref), or a signed side letter (from_envelope).');
    if (!level) throw new Refusal(400, 'bad_level', 'level is none, own_position, summary, investor or full.');
    if (target && target.id === user.id) throw new Refusal(400, 'owner_needs_no_grant', 'The owner always sees the full cap table.');

    const revokeLive = target
      ? c.env.DB.prepare(
        "UPDATE cap_table_access_grants SET revoked_at = datetime('now'), revoked_by = ? WHERE project_id = ? AND user_id = ? AND revoked_at IS NULL",
      ).bind(user.id, p.id, target.id)
      : c.env.DB.prepare(
        "UPDATE cap_table_access_grants SET revoked_at = datetime('now'), revoked_by = ? WHERE project_id = ? AND user_id IS NULL AND holder_ref = ? AND revoked_at IS NULL",
      ).bind(user.id, p.id, holderRef);
    // The revoke, the new grant and its one audit row land together or not at all.
    await c.env.DB.batch([
      revokeLive,
      c.env.DB.prepare(
        'INSERT INTO cap_table_access_grants (project_id, user_id, holder_ref, level, source, source_ref, granted_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(p.id, target?.id ?? null, holderRef, level, source, sourceRef, user.id),
      auditStmt(c.env, p.id, user.id, 'captable_access_granted', {
        level, source, ...(sourceRef ? { side_letter: sourceRef } : {}),
        ...(target ? { target_user_id: target.id } : {}), ...(holderRef ? { holder_ref: holderRef } : {}),
      }),
    ]);
    const g = await c.env.DB.prepare(
      'SELECT id, level, source, source_ref, since FROM cap_table_access_grants WHERE project_id = ? AND revoked_at IS NULL AND (user_id = ? OR (? IS NULL AND user_id IS NULL AND holder_ref = ?)) ORDER BY id DESC LIMIT 1',
    ).bind(p.id, target?.id ?? null, target?.id ?? null, holderRef).first<Record<string, unknown>>();
    return c.json({ grant: g }, 201);
  } catch (e) {
    return answer(c, e);
  }
});

r.delete('/:projectId/grants/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const p = await projectOr404(c);
    await ownerOf(c, user, p);
    const id = Number(c.req.param('id'));
    const res = await c.env.DB.prepare(
      "UPDATE cap_table_access_grants SET revoked_at = datetime('now'), revoked_by = ? WHERE id = ? AND project_id = ? AND revoked_at IS NULL",
    ).bind(user.id, Number.isInteger(id) ? id : 0, p.id).run();
    if (!Number((res as any)?.meta?.changes ?? 0)) throw new Refusal(404, 'no_such_grant', 'This venture has no live grant with that id.');
    await audit(c.env, p.id, user.id, 'captable_access_revoked', { grant_id: id });
    return c.json({ ok: true, id });
  } catch (e) {
    return answer(c, e);
  }
});

/** The venture's access log, for its founders. A support open carries its reason. */
r.get('/:projectId/log', async (c) => {
  try {
    const user = await requireAuth(c);
    const p = await projectOr404(c);
    await teamOf(c, user, p);
    const pg = page(c);
    const rows = await c.env.DB.prepare(
      `SELECT l.id, l.via, l.level, l.reason, l.opened_at,
              COALESCE(u.name, CASE WHEN l.share_token_id IS NOT NULL THEN COALESCE(t.label, 'A share link') END) AS who,
              t.label AS link_label
         FROM cap_table_access_log l LEFT JOIN users u ON u.id = l.user_id
         LEFT JOIN captable_share_tokens t ON t.id = l.share_token_id
        WHERE l.project_id = ? AND l.id < ? ORDER BY l.id DESC LIMIT ?`,
    ).bind(p.id, pg.before, pg.limit + 1).all<Record<string, unknown>>();
    const items = (rows.results || []).slice(0, pg.limit);
    return c.json({ items, next_before: (rows.results || []).length > pg.limit ? items[items.length - 1].id : null, note: 'No IP address is kept.' });
  } catch (e) {
    return answer(c, e);
  }
});

r.get('/:projectId/links', async (c) => {
  try {
    const user = await requireAuth(c);
    const p = await projectOr404(c);
    await teamOf(c, user, p);
    const rows = await c.env.DB.prepare(
      `SELECT id, label, level, expires_at, view_limit, view_count, last_viewed_at, revoked_at, holders_attested_at, created_at
         FROM captable_share_tokens WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`,
    ).bind(p.id).all<Record<string, unknown>>();
    return c.json({ items: rows.results || [] });
  } catch (e) {
    return answer(c, e);
  }
});

r.post('/:projectId/links', async (c) => {
  try {
    const user = await requireAuth(c);
    const p = await projectOr404(c);
    await ownerOf(c, user, p);
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const level = body.level as ShareAudience;
    if (!(LINK_LEVELS as readonly unknown[]).includes(level)) throw new Refusal(400, 'bad_level', 'A link is at summary, investor or full.');
    const attested = (ATTESTED_LEVELS as readonly string[]).includes(level);
    if (attested && body.holders_agreed !== true) {
      throw new Refusal(400, 'holders_not_attested', 'An Investor or Full link names holders. Confirm the holders named agreed to their positions being shared.');
    }
    const hours = body.expires_in_hours === undefined ? LINK_TTL_HOURS.default : Number(body.expires_in_hours);
    const views = body.view_limit === undefined ? LINK_VIEWS.default : Number(body.view_limit);
    if (!Number.isInteger(hours) || hours < 1 || hours > LINK_TTL_HOURS.max) throw new Refusal(400, 'bad_expiry', `A link expires in 1 to ${LINK_TTL_HOURS.max} hours.`);
    if (!Number.isInteger(views) || views < 1 || views > LINK_VIEWS.max) throw new Refusal(400, 'bad_view_limit', `A link allows 1 to ${LINK_VIEWS.max} views.`);
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 120) : null;
    // A nonce in the signed scope: the token is otherwise a pure function of
    // venture, level, expiry and actor, so two links made in one second would
    // be one token and the second would fail the unique index.
    const nonce = crypto.randomUUID().replace(/-/g, '');
    const minted = await mintShareToken(c.env, `captable-venture:${p.id}:${level}:${nonce}`, hours * 3600, String((user as any).email || ''));
    await c.env.DB.prepare(
      `INSERT INTO captable_share_tokens
         (scenario_uid, audience, token_hash, expires_at, view_limit, label, created_by, project_id, level, holders_attested_at, holders_attested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      `venture:${p.id}`, level, await sha256Hex(minted.token), minted.expires_at, views, label, user.id, p.id, level,
      attested ? new Date().toISOString() : null, attested ? user.id : null,
    ).run();
    const tok = await c.env.DB.prepare('SELECT id FROM captable_share_tokens WHERE token_hash = ?').bind(await sha256Hex(minted.token)).first<{ id: number }>();
    await audit(c.env, p.id, user.id, 'captable_link_created', { link_id: tok?.id ?? null, level, view_limit: views, attested });
    return c.json({
      id: tok?.id ?? null, token: minted.token, level, label, expires_at: minted.expires_at, view_limit: views,
      share_path: `/share/captable/venture/${minted.token}`, scope: LEVEL_SCOPE[level],
    }, 201);
  } catch (e) {
    return answer(c, e);
  }
});

r.delete('/:projectId/links/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const p = await projectOr404(c);
    await ownerOf(c, user, p);
    const id = Number(c.req.param('id'));
    const res = await c.env.DB.prepare(
      "UPDATE captable_share_tokens SET revoked_at = datetime('now'), expires_at = datetime('now') WHERE id = ? AND project_id = ? AND revoked_at IS NULL",
    ).bind(Number.isInteger(id) ? id : 0, p.id).run();
    if (!Number((res as any)?.meta?.changes ?? 0)) throw new Refusal(404, 'no_such_link', 'This venture has no live link with that id.');
    await audit(c.env, p.id, user.id, 'captable_link_revoked', { link_id: id });
    return c.json({ ok: true, id });
  } catch (e) {
    return answer(c, e);
  }
});

export default r;
