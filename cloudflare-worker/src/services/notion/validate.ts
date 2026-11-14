/**
 * D1087 (#2952, #2405 part 3) — what a founder's Notion lands in Validate.
 *
 *   - CUSTOMER RESEARCH. Each page under the picked "Interviews" source (or
 *     each row of a mapped database) waits as an `interview` proposal (D1086).
 *     Accept REQUIRES the interviewee's consent `given`, with how and when,
 *     else 409 `consent_not_given` and nothing is written (D656, D667). The
 *     page is read whole as of now; a page that changed since it was proposed
 *     is refused until it is synced again, so what is stored is what the
 *     founder saw. It lands through D667's storage step (`storeInterview`):
 *     the interview, its session with consent, the notes as its transcript,
 *     `channel` the founder's (`manual` by default). Structure and placements
 *     then run as for any session (D658): nothing reaches another module
 *     before the founder accepts a placement there. An email address or a
 *     phone number in the interviewee's label, role or company is refused.
 *   - MARKET INTELLIGENCE. Each page under the picked "Research" page lands as
 *     a fact through `addMarketSource`: its title, its Notion link and `kind =
 *     'notion'`. The text stays in Notion. The ledger (D1086) keeps one row per
 *     page: a re-sync updates it, and a source the founder deleted stays deleted.
 *
 * Registered on import (`routes/notion.ts`). Logs and audit rows hold ids and
 * counts only: never a page's text, a title or the interviewee.
 */
import { addMarketSource } from '../validateWriters';
import { ToolError, parseConsent, parseInterviewee, parseTranscript, storeInterview } from '../assistantInterviews';
import { CHANNELS } from '../interviewSessions';
import { AcceptRefused, registerAcceptor, registerFactWriter, type ProposalRow } from './sync';

export const NOTION_VIA = 'notion';
export const NOTION_VIA_NAME = 'Notion';

/** A Notion id's own page, when the read carried no link: the id is checked by `notionId` before it is ever stored. */
export const notionPageUrl = (externalId: string) => {
  const id = externalId.split(':').pop() ?? '';
  return /^[0-9a-f-]{32,36}$/i.test(id) ? `https://www.notion.so/${id.replace(/-/g, '')}` : null;
};

const refusedFrom = (e: unknown): never => {
  if (e instanceof ToolError) throw new AcceptRefused(e.status, e.code, e.message);
  throw e;
};

async function sha256(value: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

const parse = (raw: string | null) => { try { return raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { return {}; } };
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/**
 * The interviewee as the founder confirms it in the dialog, else as the row
 * mapped it, else the page's title as the label. Only a label, a role and a
 * company: an email or a phone anywhere is refused (`parseInterviewee`).
 */
function intervieweeOf(proposal: ProposalRow, payload: Record<string, unknown>, body: Record<string, unknown>) {
  const given = body.interviewee && typeof body.interviewee === 'object' && !Array.isArray(body.interviewee) ? body.interviewee as Record<string, unknown> : null;
  const raw = given ?? {
    label: text(payload.interviewee, 80) ?? text(proposal.title, 80),
    ...(text(payload.role, 80) ? { role: text(payload.role, 80) } : {}),
    ...(text(payload.company, 120) ? { company: text(payload.company, 120) } : {}),
  };
  return parseInterviewee(raw);
}

/** When it took place: the dialog's date, else the row's mapped date, else refused (never guessed). */
function occurredOf(payload: Record<string, unknown>, body: Record<string, unknown>) {
  const raw = text(body.occurred_at, 40) ?? text(payload.date, 40);
  const t = raw ? Date.parse(raw) : NaN;
  if (!Number.isFinite(t) || t > Date.now() + 5 * 60_000) {
    throw new AcceptRefused(400, 'invalid_occurred_at', 'Give the date the interview took place.');
  }
  return new Date(t).toISOString();
}

registerAcceptor({
  kind: 'interview',
  async accept(env, ctx, proposal, body, deps) {
    // Consent first: without it nothing is read and nothing is written.
    let consent;
    try { consent = parseConsent(body.consent); } catch (e) { refusedFrom(e); }
    const channel = body.channel == null || body.channel === '' ? 'manual' : String(body.channel);
    if (!(CHANNELS as readonly string[]).includes(channel)) throw new AcceptRefused(400, 'invalid_channel', `The channel is one of ${CHANNELS.join(', ')}.`);
    const payload = parse(proposal.payload_json);
    let interviewee;
    try { interviewee = intervieweeOf(proposal, payload, body); } catch (e) { refusedFrom(e); }
    const occurredIso = occurredOf(payload, body);

    // The notes, read whole as of now. A page proposal is held to what was proposed.
    const page = await (await deps.reads()).fetchPage(proposal.source_key);
    const fromPage = Object.keys(payload).length === 1 && 'last_edited' in payload;
    // The engine keys a page proposal on the SHA-256 of the page's own fingerprint (`landProposal`'s basis).
    if (fromPage && (await sha256(page.fingerprint)) !== proposal.fingerprint) {
      throw new AcceptRefused(409, 'changed_in_notion', 'This page changed in Notion after it was proposed. Sync from Notion, then import it.');
    }
    let segments;
    try { segments = parseTranscript(undefined, page.markdown); } catch (e) { refusedFrom(e); }

    let stored;
    try {
      stored = await storeInterview(env, {
        userId: ctx.userId, projectId: ctx.projectId, channel, occurredIso, interviewee: interviewee!, consent: consent!, segments: segments!, summary: null,
        via: NOTION_VIA, viaName: NOTION_VIA_NAME,
      });
    } catch (e) { refusedFrom(e); }
    await env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id, project_id) VALUES (?, ?, ?, ?, ?)')
      .bind('interview_session_submitted', JSON.stringify({ session_uid: stored!.uid, interview_id: stored!.interviewId, channel, segments: segments!.length, via: NOTION_VIA, proposal_id: proposal.id }),
        `user:${ctx.userId}`, ctx.userId, ctx.projectId).run();
    return { localTable: 'interview_sessions', localId: stored!.sessionId };
  },
});

registerFactWriter({
  module: 'market_intelligence',
  localTable: 'market_sources',
  async write(env, ctx, item, existingId) {
    const title = text(item.title, 200) ?? text(item.values.title, 200) ?? 'Untitled';
    const url = item.url ?? notionPageUrl(item.externalId);
    if (existingId) {
      // The ledger links only a row this writer created (D1086), so the id is always a Notion source.
      await env.DB.prepare('UPDATE market_sources SET title = ?, url = ? WHERE id = ? AND project_id = ?')
        .bind(title, url, existingId, ctx.projectId).run();
      return existingId;
    }
    return (await addMarketSource(env, { projectId: ctx.projectId, userId: ctx.userId, title, url, kind: 'notion' })).id;
  },
  async alive(env, projectId, id) {
    return !!(await env.DB.prepare('SELECT 1 FROM market_sources WHERE id = ? AND project_id = ?').bind(id, projectId).first());
  },
  async remove(env, projectId, id) {
    const r = await env.DB.prepare('DELETE FROM market_sources WHERE id = ? AND project_id = ?').bind(id, projectId).run();
    return !!r.meta?.changes;
  },
  async view(env, projectId, ids) {
    const rows = (await env.DB.prepare('SELECT id, title, url FROM market_sources WHERE project_id = ? AND id IN (SELECT value FROM json_each(?))')
      .bind(projectId, JSON.stringify(ids)).all<{ id: number; title: string; url: string | null }>()).results || [];
    return new Map(rows.map((r) => [Number(r.id), { title: r.title, url: r.url }]));
  },
});
