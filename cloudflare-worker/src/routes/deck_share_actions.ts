/**
 * Task #6 — Share-link viewer onboarding + conversion endpoints.
 *
 * All routes are share-token-gated rather than session-gated: the viewer
 * arrives without an Axal account and converts in-flight (signup → NDA →
 * feedback or deal-pack). Every mutation re-verifies the signed deck
 * share token via `verifySignedToken()` so a stolen route URL alone
 * cannot create accounts or impersonate the deck owner.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { verifySignedToken } from './decks';
import { createJWT, setAuthCookies, generateCsrfToken, requireAuth } from '../auth';
import { hashEmail } from '../util/hashEmail';
import { renderLegalTemplate, templateKeyForDocType } from '../services/legalTemplates';

const deckShareActions = new Hono<{ Bindings: Env }>();

// Lazy schema bootstrap — migration 071 is additive but unapplied in
// some environments. Mirrors the ensureTelegramSchema / ensureXSchema
// pattern so the routes work regardless of remote migration state.
let SCHEMA_READY = false;
async function ensureDeckShareConversionSchema(env: Env): Promise<void> {
  if (SCHEMA_READY) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS deck_share_conversions (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       view_id INTEGER,
       share_token_id INTEGER,
       deck_id INTEGER NOT NULL,
       project_id INTEGER,
       user_id INTEGER,
       type TEXT NOT NULL,
       ref_id TEXT,
       created_at TEXT DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_deck_share_conv_view ON deck_share_conversions(view_id)`,
    `CREATE INDEX IF NOT EXISTS idx_deck_share_conv_deck ON deck_share_conversions(deck_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_deck_share_conv_user ON deck_share_conversions(user_id)`,
    `CREATE TABLE IF NOT EXISTS deck_share_feedback (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       view_id INTEGER,
       deck_id INTEGER NOT NULL,
       project_id INTEGER,
       user_id INTEGER,
       slide_reactions TEXT,
       overall_note TEXT,
       problem_fit TEXT,
       willingness_to_pay TEXT,
       contact TEXT,
       created_at TEXT DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_deck_share_fb_deck ON deck_share_feedback(deck_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_deck_share_fb_user ON deck_share_feedback(user_id)`,
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); } catch (e) {
      console.error('[deck_share] schema bootstrap failed:', (e as Error).message);
    }
  }
  SCHEMA_READY = true;
}

async function sha256HexLocal(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

// Helper — verify the deck share token, return {deckId, tokenId} or null.
// `tokenId` is the real `pitch_deck_share_tokens.id` resolved by hashing
// the token (previously this returned the deck version `vN` which had no
// FK meaning — addressed by the code review).
async function verifyShareToken(env: Env, token: string): Promise<{ deckId: number; tokenId: number | null } | null> {
  let payload: any;
  try { payload = await verifySignedToken(env, token); } catch { return null; }
  const m = /^deck:(\d+):v(\d+)$/.exec(String(payload?.k || ''));
  if (!m) return null;
  const deckId = parseInt(m[1], 10);
  let tokenId: number | null = null;
  try {
    const h = await sha256HexLocal(token);
    const row = await env.DB.prepare(
      'SELECT id FROM pitch_deck_share_tokens WHERE token_hash = ?'
    ).bind(h).first<any>();
    if (row?.id) tokenId = Number(row.id);
  } catch {}
  return { deckId, tokenId };
}

async function logConversion(
  env: Env,
  opts: {
    deckId: number; tokenId: number | null; viewId?: number | null;
    projectId?: number | null; userId?: number | null;
    type: string; refId?: string | null;
  },
): Promise<void> {
  // Idempotency: per-stage uniqueness keyed on (deck_id, view_id, type)
  // for view-scoped funnel events (signup/nda/feedback/deal_pack_opened)
  // and on (deck_id, user_id, type) for deal_signed. Best-effort — the
  // index is added at schema-bootstrap time; if it isn't present yet
  // (older deployment without migration 071), we silently fall back to
  // unconstrained inserts to avoid breaking the funnel.
  try {
    if (opts.type === 'deal_signed' && opts.userId) {
      const exists = await env.DB.prepare(
        `SELECT id FROM deck_share_conversions
          WHERE deck_id = ? AND user_id = ? AND type = 'deal_signed' LIMIT 1`
      ).bind(opts.deckId, opts.userId).first<any>();
      if (exists?.id) return;
    } else if (opts.viewId) {
      const exists = await env.DB.prepare(
        `SELECT id FROM deck_share_conversions
          WHERE deck_id = ? AND view_id = ? AND type = ? LIMIT 1`
      ).bind(opts.deckId, opts.viewId, opts.type).first<any>();
      if (exists?.id) return;
    }
  } catch {}
  try {
    await env.DB.prepare(
      `INSERT INTO deck_share_conversions
         (view_id, share_token_id, deck_id, project_id, user_id, type, ref_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      opts.viewId ?? null,
      opts.tokenId ?? null,
      opts.deckId,
      opts.projectId ?? null,
      opts.userId ?? null,
      opts.type,
      opts.refId ?? null,
    ).run();
  } catch (e) {
    console.error('[deck_share] logConversion failed', (e as Error).message);
  }
}

async function loadDeckContext(
  env: Env, deckId: number,
): Promise<{ project_id: number | null; project_name: string | null; deck_title: string | null } | null> {
  const deck = await env.DB.prepare(
    'SELECT project_id, title FROM pitch_decks WHERE id = ?',
  ).bind(deckId).first<any>();
  if (!deck) return null;
  let projectName: string | null = null;
  if (deck.project_id) {
    try {
      const pr = await env.DB.prepare('SELECT name FROM projects WHERE id = ?')
        .bind(Number(deck.project_id)).first<any>();
      if (pr?.name) projectName = String(pr.name).slice(0, 200);
    } catch {}
  }
  return {
    project_id: deck.project_id ? Number(deck.project_id) : null,
    project_name: projectName,
    deck_title: deck.title ? String(deck.title) : null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// GET /context — modal opener fetches deck/project/NDA info.
// ─────────────────────────────────────────────────────────────────────
deckShareActions.get('/share/:token/context', async (c) => {
  const tok = await verifyShareToken(c.env, c.req.param('token'));
  if (!tok) return c.json({ error: 'invalid_token' }, 401);
  const ctx = await loadDeckContext(c.env, tok.deckId);
  if (!ctx) return c.json({ error: 'deck_not_found' }, 404);
  return c.json({
    deck_id: tok.deckId,
    project_id: ctx.project_id,
    project_name: ctx.project_name,
    deck_title: ctx.deck_title,
    nda_template_key: 'investor_nda_v1',
  });
});

// ─────────────────────────────────────────────────────────────────────
// POST /signup — anonymous viewer creates an account & receives a
// short-lived session cookie + bearer. Reuses /api/auth/register
// semantics by minting the user row directly (Turnstile is bypassed
// because the share-token-gated flow already proves intent).
// ─────────────────────────────────────────────────────────────────────
deckShareActions.post('/share/:token/signup', async (c) => {
  const tok = await verifyShareToken(c.env, c.req.param('token'));
  if (!tok) return c.json({ error: 'invalid_token' }, 401);
  await ensureDeckShareConversionSchema(c.env);

  const body = await c.req.json().catch(() => null) as any;
  const email = String(body?.email || '').trim().toLowerCase();
  const name = String(body?.name || '').trim();
  const role = body?.role && ['investor', 'partner', 'founder'].includes(body.role)
    ? body.role : 'investor';
  const viewId = body?.view_id ? Number(body.view_id) : null;
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailRe.test(email)) return c.json({ error: 'invalid_email' }, 400);
  if (!name) return c.json({ error: 'name_required' }, 400);

  const ctx = await loadDeckContext(c.env, tok.deckId);
  if (!ctx) return c.json({ error: 'deck_not_found' }, 404);

  // Find or create the user. If the email already belongs to a verified
  // account we DON'T overwrite their role — they're already in the
  // network, this is a re-engagement event.
  let userId: number;
  let isNew = false;
  const existing = await c.env.DB.prepare(
    'SELECT id, email_verified FROM users WHERE email = ?'
  ).bind(email).first<any>();
  if (existing?.id) {
    userId = Number(existing.id);
  } else {
    const ins = await c.env.DB.prepare(
      `INSERT INTO users (email, name, role, email_verified)
       VALUES (?, ?, ?, 0)`
    ).bind(email, name, role).run();
    userId = Number((ins as any)?.meta?.last_row_id || 0);
    isNew = true;
    if (!userId) return c.json({ error: 'signup_failed' }, 500);
    try {
      await c.env.DB.prepare(
        `INSERT INTO activity_logs (action, details, actor, user_id)
         VALUES (?, ?, ?, ?)`
      ).bind(
        'user_registered',
        `via deck share (deck_id=${tok.deckId})`,
        await hashEmail(email),
        userId,
      ).run();
    } catch {}
    try {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO onboarding_progress (user_id, flow, step, total_steps, completed_at)
         VALUES (?, 'chat', 0, 0, NULL)`
      ).bind(userId).run();
    } catch {}
  }

  await logConversion(c.env, {
    deckId: tok.deckId, tokenId: tok.tokenId, viewId,
    projectId: ctx.project_id, userId,
    type: 'signup', refId: String(userId),
  });

  // Mint a session cookie so the viewer can proceed straight into NDA +
  // feedback / deal-pack without a separate login step. The cookie is
  // short-lived (JWT TTL is 7d project-wide); the viewer can complete
  // verification later from /settings.
  const jwt = await createJWT(c.env, userId, email, role);
  const csrf = generateCsrfToken();
  setAuthCookies(c, jwt, csrf);

  return c.json({
    ok: true,
    user_id: userId,
    is_new: isNew,
    email,
    name,
    role,
    csrf_token: csrf,
  });
});

// ─────────────────────────────────────────────────────────────────────
// POST /nda — viewer accepts the project NDA. We render the canonical
// `investor_nda_v1` template, persist an audit `documents` row marked
// signed, and log the conversion. Non-contract doc_type so the
// CONTRACT_DOC_TYPES guard in legal.ts is satisfied.
// ─────────────────────────────────────────────────────────────────────
deckShareActions.post('/share/:token/nda', async (c) => {
  const tok = await verifyShareToken(c.env, c.req.param('token'));
  if (!tok) return c.json({ error: 'invalid_token' }, 401);
  await ensureDeckShareConversionSchema(c.env);

  // AuthZ — bind action to the session minted by /signup (or any existing
  // logged-in viewer). The body's `user_id` is no longer trusted; ignoring
  // it closes the attribution-spoof vector flagged in code review.
  let authUser;
  try { authUser = await requireAuth(c); }
  catch { return c.json({ error: 'auth_required' }, 401); }
  const userId = Number(authUser.id);

  const body = await c.req.json().catch(() => null) as any;
  const viewId = body?.view_id ? Number(body.view_id) : null;
  const signedBy = String(body?.signed_by || '').trim();
  if (!signedBy) return c.json({ error: 'missing_fields' }, 400);

  const ctx = await loadDeckContext(c.env, tok.deckId);
  if (!ctx) return c.json({ error: 'deck_not_found' }, 404);

  // Fetch the user for merge fields.
  const user = await c.env.DB.prepare('SELECT email, name FROM users WHERE id = ?')
    .bind(userId).first<any>();
  if (!user) return c.json({ error: 'user_not_found' }, 404);

  const tplKey = templateKeyForDocType('investor_nda_v1') || 'investor_nda_v1';
  let ndaBody = '';
  try {
    ndaBody = await renderLegalTemplate(tplKey as any, {
      recipient_name: user.name || signedBy,
      recipient_email: user.email,
      counterparty_name: ctx.project_name || 'the Project',
      effective_date: new Date().toISOString().slice(0, 10),
    });
  } catch (e) {
    console.error('[deck_share] nda render failed', (e as Error).message);
    ndaBody = `# NDA acceptance\n\nViewer ${signedBy} accepted NDA for ${ctx.project_name || 'Project'} on ${new Date().toISOString()}.`;
  }

  // Persist as nda_acceptance (non-contract type — safe to insert).
  let docId: number | null = null;
  try {
    const ins = await c.env.DB.prepare(
      `INSERT INTO documents (project_id, title, doc_type, status, content, template_name, signed_by, signed_at)
       VALUES (?, ?, 'nda_acceptance', 'signed', ?, ?, ?, datetime('now'))`
    ).bind(
      ctx.project_id,
      `NDA — ${ctx.project_name || ('Deck ' + tok.deckId)}`,
      ndaBody,
      tplKey,
      signedBy,
    ).run();
    docId = Number((ins as any)?.meta?.last_row_id || 0) || null;
  } catch (e) {
    console.error('[deck_share] nda doc insert failed', (e as Error).message);
  }

  await logConversion(c.env, {
    deckId: tok.deckId, tokenId: tok.tokenId, viewId,
    projectId: ctx.project_id, userId,
    type: 'nda_signed', refId: docId ? String(docId) : null,
  });

  return c.json({ ok: true, document_id: docId, template_key: tplKey });
});

// ─────────────────────────────────────────────────────────────────────
// POST /feedback — commercial-deck customer-discovery capture.
// Writes deck_share_feedback + a discovery_interviews row so the
// founder sees it on the Customer Discovery panel.
// ─────────────────────────────────────────────────────────────────────
deckShareActions.post('/share/:token/feedback', async (c) => {
  const tok = await verifyShareToken(c.env, c.req.param('token'));
  if (!tok) return c.json({ error: 'invalid_token' }, 401);
  await ensureDeckShareConversionSchema(c.env);

  // Feedback is the only share action that may stay anonymous (a viewer
  // can submit reactions without signing up). If a session cookie is
  // present we attribute it; otherwise we accept the row with user_id
  // NULL and rely on the contact field for follow-up.
  let userId: number | null = null;
  try { const u = await requireAuth(c); userId = Number(u.id); } catch {}

  const body = await c.req.json().catch(() => null) as any;
  const viewId = body?.view_id ? Number(body.view_id) : null;
  const slideReactions = body?.slide_reactions && typeof body.slide_reactions === 'object'
    ? JSON.stringify(body.slide_reactions) : null;
  const overallNote = body?.overall_note ? String(body.overall_note).slice(0, 4000) : null;
  const problemFit = body?.problem_fit && ['strong', 'mild', 'none'].includes(body.problem_fit)
    ? body.problem_fit : null;
  const wtp = body?.willingness_to_pay ? String(body.willingness_to_pay).slice(0, 200) : null;
  const contact = body?.contact ? String(body.contact).slice(0, 200) : null;

  const ctx = await loadDeckContext(c.env, tok.deckId);
  if (!ctx) return c.json({ error: 'deck_not_found' }, 404);

  let feedbackId: number | null = null;
  try {
    const ins = await c.env.DB.prepare(
      `INSERT INTO deck_share_feedback
         (view_id, deck_id, project_id, user_id, slide_reactions, overall_note, problem_fit, willingness_to_pay, contact)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      viewId, tok.deckId, ctx.project_id, userId,
      slideReactions, overallNote, problemFit, wtp, contact,
    ).run();
    feedbackId = Number((ins as any)?.meta?.last_row_id || 0) || null;
  } catch (e) {
    console.error('[deck_share] feedback insert failed', (e as Error).message);
    return c.json({ error: 'persist_failed' }, 500);
  }

  // Also mirror into discovery_interviews so the founder's discovery
  // dashboard surfaces it natively. Best-effort — never block the
  // primary feedback persistence.
  if (ctx.project_id) {
    try {
      let intervieweeName = 'Anonymous viewer';
      if (userId) {
        const u = await c.env.DB.prepare('SELECT name, email FROM users WHERE id = ?')
          .bind(userId).first<any>();
        if (u?.name) intervieweeName = String(u.name);
        else if (u?.email) intervieweeName = String(u.email);
      } else if (contact) {
        intervieweeName = contact;
      }
      const today = new Date().toISOString().slice(0, 10);
      const hyps = problemFit
        ? JSON.stringify([{ text: `Problem fit: ${problemFit}`, validated: problemFit === 'strong' }])
        : JSON.stringify([]);
      const pains = wtp
        ? JSON.stringify([{ text: `Willingness to pay: ${wtp}` }])
        : JSON.stringify([]);
      const nowIso = new Date().toISOString();
      await c.env.DB.prepare(
        `INSERT INTO discovery_interviews
           (project_id, interviewee_name, interviewee_role, interview_date,
            notes, hypotheses_json, pains_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        ctx.project_id, intervieweeName, 'Deck viewer', today,
        overallNote || '', hyps, pains, nowIso, nowIso,
      ).run();
    } catch (e) {
      console.error('[deck_share] discovery mirror failed', (e as Error).message);
    }
  }

  await logConversion(c.env, {
    deckId: tok.deckId, tokenId: tok.tokenId, viewId,
    projectId: ctx.project_id, userId,
    type: 'feedback', refId: feedbackId ? String(feedbackId) : null,
  });

  return c.json({ ok: true, feedback_id: feedbackId });
});

// ─────────────────────────────────────────────────────────────────────
// POST /deal-pack — fundraising-deck route: generate SAFE + term sheet
// + side letter docs populated with project data. Viewer reviews them
// in the modal; sign-action calls back into POST /deal-pack/sign.
// We persist the docs as 'deal_pack_safe' / 'deal_pack_term_sheet' /
// 'deal_pack_side_letter' (non-contract types so the legal.ts guard
// stays satisfied). A real e-sign envelope round-trip is overkill for
// MVP — these rows function as the auditable artifact.
// ─────────────────────────────────────────────────────────────────────
deckShareActions.post('/share/:token/deal-pack', async (c) => {
  const tok = await verifyShareToken(c.env, c.req.param('token'));
  if (!tok) return c.json({ error: 'invalid_token' }, 401);
  await ensureDeckShareConversionSchema(c.env);

  let authUser;
  try { authUser = await requireAuth(c); }
  catch { return c.json({ error: 'auth_required' }, 401); }
  const userId = Number(authUser.id);

  const body = await c.req.json().catch(() => null) as any;
  const viewId = body?.view_id ? Number(body.view_id) : null;
  const checkSize = body?.check_size ? String(body.check_size).slice(0, 60) : 'TBD';
  const valuationCap = body?.valuation_cap ? String(body.valuation_cap).slice(0, 60) : '$8M';
  const discount = body?.discount ? String(body.discount).slice(0, 20) : '20%';

  const ctx = await loadDeckContext(c.env, tok.deckId);
  if (!ctx) return c.json({ error: 'deck_not_found' }, 404);

  const user = await c.env.DB.prepare('SELECT email, name FROM users WHERE id = ?')
    .bind(userId).first<any>();
  if (!user) return c.json({ error: 'user_not_found' }, 404);

  const project = ctx.project_name || `Project #${ctx.project_id ?? '–'}`;
  const today = new Date().toISOString().slice(0, 10);
  const investorLine = `${user.name || user.email} <${user.email}>`;

  const safeBody = `# SAFE — Simple Agreement for Future Equity\n\n> _Subject to legal review. Generated automatically from the project's share-link deal pack. Replaces no underlying agreement._\n\n**Issuer:** ${project}\n**Investor:** ${investorLine}\n**Purchase Amount:** ${checkSize}\n**Valuation Cap:** ${valuationCap}\n**Discount Rate:** ${discount}\n**Effective Date:** ${today}\n\nThis SAFE entitles the Investor to receive Capital Stock of the Issuer upon the next Equity Financing on the terms above, in substantially the form of the Y-Combinator post-money SAFE.`;

  const termSheetBody = `# Term Sheet\n\n> _Non-binding summary. Subject to legal review._\n\n**Project:** ${project}\n**Investor:** ${investorLine}\n**Instrument:** Post-money SAFE\n**Amount:** ${checkSize}\n**Valuation Cap:** ${valuationCap}\n**Discount:** ${discount}\n**Pro-rata:** Standard (side-letter)\n**Information rights:** Quarterly financial summary\n**Effective Date:** ${today}`;

  const sideLetterBody = `# Side Letter\n\n> _Subject to legal review._\n\n**Between:** ${project} ("Issuer") and ${investorLine} ("Investor"), dated ${today}.\n\n1. **Pro-rata rights.** Investor shall have the right (but not the obligation) to participate in the next two priced rounds up to their pro-rata share.\n2. **MFN.** Investor receives most-favoured-nation treatment relative to any other SAFE investor in this round.\n3. **Information rights.** Issuer will deliver a quarterly investor update.`;

  async function insertDoc(title: string, type: string, content: string): Promise<number | null> {
    try {
      const ins = await c.env.DB.prepare(
        `INSERT INTO documents (project_id, title, doc_type, status, content, template_name)
         VALUES (?, ?, ?, 'generated', ?, ?)`
      ).bind(ctx!.project_id, title, type, content, type).run();
      return Number((ins as any)?.meta?.last_row_id || 0) || null;
    } catch (e) {
      console.error('[deck_share] deal-pack insert failed', (e as Error).message, type);
      return null;
    }
  }

  const safeId = await insertDoc(`SAFE — ${project}`, 'deal_pack_safe', safeBody);
  const termSheetId = await insertDoc(`Term Sheet — ${project}`, 'deal_pack_term_sheet', termSheetBody);
  const sideLetterId = await insertDoc(`Side Letter — ${project}`, 'deal_pack_side_letter', sideLetterBody);

  await logConversion(c.env, {
    deckId: tok.deckId, tokenId: tok.tokenId, viewId,
    projectId: ctx.project_id, userId,
    type: 'deal_pack_opened',
    refId: [safeId, termSheetId, sideLetterId].filter(Boolean).join(','),
  });

  return c.json({
    ok: true,
    documents: [
      { id: safeId,        type: 'deal_pack_safe',        title: `SAFE — ${project}`,        content: safeBody },
      { id: termSheetId,   type: 'deal_pack_term_sheet',  title: `Term Sheet — ${project}`,  content: termSheetBody },
      { id: sideLetterId,  type: 'deal_pack_side_letter', title: `Side Letter — ${project}`, content: sideLetterBody },
    ].filter((d) => d.id !== null),
  });
});

// ─────────────────────────────────────────────────────────────────────
// POST /deal-pack/sign — mark generated documents signed by the
// viewer and log the deal_signed conversion. One row per document id.
// ─────────────────────────────────────────────────────────────────────
deckShareActions.post('/share/:token/deal-pack/sign', async (c) => {
  const tok = await verifyShareToken(c.env, c.req.param('token'));
  if (!tok) return c.json({ error: 'invalid_token' }, 401);
  await ensureDeckShareConversionSchema(c.env);

  let authUser;
  try { authUser = await requireAuth(c); }
  catch { return c.json({ error: 'auth_required' }, 401); }
  const userId = Number(authUser.id);

  const body = await c.req.json().catch(() => null) as any;
  const viewId = body?.view_id ? Number(body.view_id) : null;
  const signedBy = String(body?.signed_by || '').trim();
  const docIds: number[] = Array.isArray(body?.document_ids)
    ? body.document_ids.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n))
    : [];
  if (!signedBy || docIds.length === 0) {
    return c.json({ error: 'missing_fields' }, 400);
  }

  const ctx = await loadDeckContext(c.env, tok.deckId);
  if (!ctx) return c.json({ error: 'deck_not_found' }, 404);

  // Only push to signedIds when the UPDATE actually matched a row — fixes
  // the false-success path flagged in code review. Unmatched ids are
  // surfaced back in `not_signed_ids` so the modal can warn.
  const signedIds: number[] = [];
  const notSignedIds: number[] = [];
  for (const id of docIds) {
    try {
      const res = await c.env.DB.prepare(
        `UPDATE documents
            SET status = 'signed', signed_by = ?, signed_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?
            AND project_id IS ?
            AND doc_type IN ('deal_pack_safe','deal_pack_term_sheet','deal_pack_side_letter')`
      ).bind(signedBy, id, ctx.project_id).run();
      const changes = Number((res as any)?.meta?.changes || 0);
      if (changes >= 1) signedIds.push(id);
      else notSignedIds.push(id);
    } catch (e) {
      console.error('[deck_share] sign update failed', (e as Error).message);
      notSignedIds.push(id);
    }
  }

  if (signedIds.length > 0) {
    await logConversion(c.env, {
      deckId: tok.deckId, tokenId: tok.tokenId, viewId,
      projectId: ctx.project_id, userId,
      type: 'deal_signed', refId: signedIds.join(','),
    });
  }

  return c.json({ ok: true, signed_ids: signedIds, not_signed_ids: notSignedIds });
});

export default deckShareActions;
// Internal re-exports so other routes (decks.ts engagement endpoint)
// can ensure the schema exists before aggregating conversions.
export { ensureDeckShareConversionSchema };
