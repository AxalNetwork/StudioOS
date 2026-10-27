/**
 * D1094 (#2959, Google Workspace part 5) — a member's chosen Google files feed
 * their Raise modules. READ-ONLY at Google: Drive, Slides and Calendar are only
 * read, through `workspaceRead`'s allowlist and `GOOGLE_CALENDAR_READS` below.
 *
 * | Module                | From Google                              | Lands as |
 * | --------------------- | ---------------------------------------- | -------- |
 * | Pitch deck            | a chosen Slides deck: each slide's title, body text and speaker notes | proposal "Import “X” as version N?"; Accept writes a new version, the current one stays |
 * | Data room             | chosen Drive files; a Google file exported to PDF | fact: a copy in R2, NDA and seen by nobody until the founder opens it; replaced only when Google's `modifiedTime` changed |
 * | Capital relationships | Calendar events in the last 180 days whose attendee domain is a prospect's firm domain | proposal "Last met <day>"; Accept logs a meeting on the prospect |
 *
 * EVERY ROW GOES THROUGH THE LEDGER (`connector_fed_items`, D655). A copy's
 * ledger row is `<drive file id>:copy:<project>`, so part 2's "Stop using"
 * unlinks it. A copy the founder deleted keeps its ledger row with no
 * `local_id`, and a re-sync never copies it again. A proposal is proposed once
 * per source (`google_workspace_proposals`, migration 588): a decided one is
 * never proposed again; a pending one is refreshed, and a pending one a newer
 * source replaces is withdrawn.
 *
 * NOTHING FROM AN EVENT IS STORED BUT ITS DAY. An attendee's address is read
 * in memory only to take its domain, matched against the prospects' own firm
 * domains; no address, title or description is stored, returned or logged.
 * Logs hold counts and codes only.
 */
import type { Env, User } from '../../types';
import { loadRefreshTokenExport, refreshGoogleAccessToken, reencryptRefreshTokenExport } from '../calendar';
import { assertStorageRoom, noteStorageLanded } from '../storageRoom';
import { logCycleWrite } from '../cycleActivity';
import { logProspectEvent, WriterError } from '../raiseWriters';
import { insertVersion, sanitizeSlides } from '../../routes/decks';
import { MAX_COPY_BYTES, WorkspaceError, type WorkspaceRead } from './workspace';

// ───────────────────────────────────────────────────────────── constants

/** The Calendar read, GET only. The grant is the member's existing Calendar consent. */
export const GOOGLE_CALENDAR_READS = Object.freeze({
  'events.list': Object.freeze({ origin: 'https://www.googleapis.com', path: '/calendar/v3/calendars/primary/events' }),
});
const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar'];
export const CALENDAR_DAYS = 180;
const MAX_EVENT_PAGES = 4;
export const MAX_SLIDES = 60;
/** Webmail domains name no firm: never matched. */
export const FREE_MAIL = Object.freeze(new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com']));
/** A copy waits behind NDA, seen by nobody, until the founder opens access (as Mercury's statements, D840). */
export const COPY_ACCESS = { visibility: 'nda', access_tier: 'nobody' } as const;
const NATIVE_PREFIX = 'application/vnd.google-apps.';
const MIME = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const COPY_EXT = (fileId: string, projectId: number) => `${fileId}:copy:${projectId}`;
const DECK_EXT = (fileId: string, projectId: number, version: string) => `${fileId}:deck:${projectId}:${version}`;
const MET_EXT = (projectId: number, prospectId: number, day: string) => `calendar:met:${projectId}:${prospectId}:${day}`;

export type Reader = (call: WorkspaceRead, id: string, options?: { mimeType?: string; maxBytes?: number }) => Promise<any>;
/** Each event as this feed needs it: its day and its attendees' domains, never an address. */
export type EventDays = (fromIso: string, toIso: string) => Promise<{ events: { day: string; domains: string[] }[]; capped: boolean }>;

// ───────────────────────────────────────────────────────────── Slides → a deck version

const textOf = (el: any): string => (Array.isArray(el?.shape?.text?.textElements) ? el.shape.text.textElements : [])
  .map((t: any) => (typeof t?.textRun?.content === 'string' ? t.textRun.content : '')).join('').replace(/\s+\n/g, '\n').trim();

/**
 * A presentation as the deck editor's slides: each slide's title (its TITLE or
 * CENTERED_TITLE placeholder), its other text as the body, and its speaker
 * notes. Images, charts and tables are not carried: the founder adds them in
 * the editor. At most 60 slides, as the editor takes.
 */
export function slidesFromPresentation(p: any): { title: string | null; slides: { title: string; body: string; notes?: string }[] } {
  const slides = (Array.isArray(p?.slides) ? p.slides : []).slice(0, MAX_SLIDES).map((s: any, i: number) => {
    const els = Array.isArray(s?.pageElements) ? s.pageElements : [];
    const isTitle = (e: any) => ['TITLE', 'CENTERED_TITLE'].includes(e?.shape?.placeholder?.type);
    const title = textOf(els.find(isTitle)) || `Slide ${i + 1}`;
    const body = els.filter((e: any) => !isTitle(e)).map(textOf).filter(Boolean).join('\n');
    const notesId = s?.slideProperties?.notesPage?.notesProperties?.speakerNotesObjectId;
    const notesEl = notesId ? (s.slideProperties.notesPage.pageElements || []).find((e: any) => e?.objectId === notesId) : null;
    const notes = textOf(notesEl);
    return { title: title.slice(0, 120), body: body.slice(0, 4000), ...(notes ? { notes: notes.slice(0, 4000) } : {}) };
  });
  return { title: typeof p?.title === 'string' && p.title.trim() ? p.title.trim().slice(0, 200) : null, slides };
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ───────────────────────────────────────────────────────────── Calendar

/** The member's Calendar grant, read only: events in [from, to], each reduced to its day and attendee domains. */
export function calendarEventDays(env: Env, userId: number, fetcher: typeof fetch = fetch): EventDays {
  return async (fromIso, toIso) => {
    const row = await env.DB.prepare('SELECT scope FROM google_oauth_tokens WHERE user_id = ?').bind(userId).first<{ scope: string | null }>();
    if (!row) throw new WorkspaceError('google_not_connected', 409);
    const granted = String(row.scope || '').split(/[\s,]+/);
    if (!CALENDAR_SCOPES.some((s) => granted.includes(s))) throw new WorkspaceError('calendar_not_allowed', 409);
    const stored = await loadRefreshTokenExport(env, 'google_oauth_tokens', userId);
    if (!stored?.raw) throw new WorkspaceError('google_not_connected', 409);
    let token: string;
    try { token = await refreshGoogleAccessToken(env, stored.raw); } catch { throw new WorkspaceError('google_unreadable'); }
    if (stored.wasPlaintext) await reencryptRefreshTokenExport(env, 'google_oauth_tokens', userId, stored.raw);
    const spec = GOOGLE_CALENDAR_READS['events.list'];
    const events: { day: string; domains: string[] }[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
      const url = new URL(spec.path, spec.origin);
      url.search = new URLSearchParams({ timeMin: fromIso, timeMax: toIso, singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
        fields: 'items(start,attendees(email,self)),nextPageToken', ...(pageToken ? { pageToken } : {}) }).toString();
      let res: Response;
      try { res = await fetcher(url.toString(), { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${token}` } }); }
      catch { throw new WorkspaceError('google_unreadable'); }
      if (!res.ok) throw new WorkspaceError(res.status === 429 ? 'google_rate_limited' : 'google_unreadable');
      const body: any = await res.json().catch(() => null);
      if (!body || typeof body !== 'object') throw new WorkspaceError('google_unreadable');
      for (const e of Array.isArray(body.items) ? body.items : []) {
        const day = String(e?.start?.date || e?.start?.dateTime || '').slice(0, 10);
        if (!DAY.test(day)) continue;
        const domains = new Set<string>();
        for (const a of Array.isArray(e?.attendees) ? e.attendees : []) {
          if (a?.self === true) continue;
          const d = domainOf(a?.email);
          if (d) domains.add(d);
        }
        if (domains.size) events.push({ day, domains: [...domains] });
      }
      pageToken = typeof body.nextPageToken === 'string' && body.nextPageToken.length <= 2048 ? body.nextPageToken : null;
      if (!pageToken) return { events, capped: false };
    }
    return { events, capped: true };
  };
}

/** A firm's domain from an address, lower-case, or null for a webmail domain or no domain at all. */
export function domainOf(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const d = email.slice(at + 1).trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) || FREE_MAIL.has(d)) return null;
  return d;
}

// ───────────────────────────────────────────────────────────── statements

// Once per source: a decided proposal is never proposed again; a pending one is refreshed.
const PROPOSE = `INSERT INTO google_workspace_proposals (integration_id, project_id, module, kind, source_key, fingerprint, title, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(integration_id, project_id, source_key) DO UPDATE SET
       fingerprint = excluded.fingerprint, title = excluded.title, payload_json = excluded.payload_json
     WHERE google_workspace_proposals.status = 'pending'`;
// A pending proposal a newer source of the same thing replaces is withdrawn.
const WITHDRAW = `DELETE FROM google_workspace_proposals
     WHERE integration_id = ? AND project_id = ? AND status = 'pending' AND substr(source_key, 1, length(?)) = ? AND source_key <> ?`;
const LEDGER = `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(integration_id, external_id) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP, local_table = excluded.local_table, local_id = excluded.local_id`;
// A copy the founder deleted in the data room unlinks its ledger row, so it reads as deleted (#1906).
const UNLINK_GONE = `UPDATE connector_fed_items SET local_id = NULL
     WHERE integration_id = ? AND project_id = ? AND local_table = 'data_room_files' AND local_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM data_room_files t WHERE t.id = connector_fed_items.local_id)`;

export type SyncCounts = Record<string, number | boolean | string>;

// ───────────────────────────────────────────────────────────── the sync

/**
 * One sync of a venture's Raise feeds from the member's chosen files and
 * calendar. A file Google refuses is marked unreadable and the others still
 * sync; a rate limit stops the sync where it is ("partly synced").
 */
export async function syncRaiseGoogle(env: Env, a: {
  integrationId: number; projectId: number; user: User; read: Reader; eventDays: EventDays | null; now?: Date;
}): Promise<SyncCounts> {
  const now = a.now ?? new Date();
  const counts: SyncCounts = { decks_proposed: 0, copies_added: 0, copies_replaced: 0, copies_unchanged: 0, copies_kept_deleted: 0, files_unreadable: 0, last_met_proposed: 0, partly_synced: false };
  const { integrationId: i, projectId: pid } = a;
  await env.DB.prepare(UNLINK_GONE).bind(i, pid).run();
  const files = (await env.DB.prepare(
    `SELECT * FROM google_workspace_files WHERE integration_id = ? AND user_id = ? AND project_id = ? AND module IN ('pitch_deck','data_room') AND status <> 'stopped' ORDER BY id`,
  ).bind(i, a.user.id, pid).all<any>()).results || [];
  for (const f of files) {
    try {
      if (f.module === 'pitch_deck' && f.kind === 'slides') counts.decks_proposed = Number(counts.decks_proposed) + await proposeDeck(env, a, f);
      else if (f.module === 'data_room') {
        const out = await copyFile(env, a, f);
        const key = `copies_${out}`;
        counts[key] = Number(counts[key] ?? 0) + 1;
      }
    } catch (e) {
      const code = e instanceof WorkspaceError ? e.code : 'google_unreadable';
      if (code === 'google_rate_limited') { counts.partly_synced = true; break; }
      if (code === 'storage_full' || code === 'storage_not_configured') { counts.partly_synced = true; counts.stopped = code; break; }
      counts.files_unreadable = Number(counts.files_unreadable) + 1;
      await env.DB.prepare(`UPDATE google_workspace_files SET status = 'unreadable', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(code, f.id).run();
    }
  }
  if (a.eventDays && !counts.partly_synced) {
    try { counts.last_met_proposed = await proposeLastMet(env, a, now); }
    catch (e) {
      const code = e instanceof WorkspaceError ? e.code : 'google_unreadable';
      counts.calendar = code;
      if (code === 'google_rate_limited') counts.partly_synced = true;
    }
  }
  return counts;
}

async function proposeDeck(env: Env, a: { integrationId: number; projectId: number; read: Reader }, f: any): Promise<number> {
  const meta = await a.read('files.get', f.drive_file_id);
  if (meta?.trashed === true) throw new WorkspaceError('file_not_shared', 403);
  const deck = slidesFromPresentation(await a.read('presentations.get', f.drive_file_id));
  await markRead(env, f.id, meta);
  if (!deck.slides.length) return 0;
  const version = typeof meta?.modifiedTime === 'string' && meta.modifiedTime.length <= 40 ? meta.modifiedTime : 'not-recorded';
  const prefix = `slides:${f.drive_file_id}:`;
  const sourceKey = prefix + version;
  const name = typeof meta?.name === 'string' && meta.name.trim() ? meta.name.trim().slice(0, 200) : String(f.name).slice(0, 200);
  const payload = { file_id: f.drive_file_id, file_name: name, modified_time: version === 'not-recorded' ? null : version, slides: deck.slides };
  const json = JSON.stringify(payload);
  await env.DB.batch([
    env.DB.prepare(WITHDRAW).bind(a.integrationId, a.projectId, prefix, prefix, sourceKey),
    env.DB.prepare(PROPOSE).bind(a.integrationId, a.projectId, 'pitch_deck', 'deck_version', sourceKey, await sha256(json), `Import “${name}”`, json),
  ]);
  return 1;
}

/** What a sync did to one chosen file: copied it, replaced its copy, left it, or kept the founder's deletion. */
async function copyFile(env: Env, a: { integrationId: number; projectId: number; user: User; read: Reader }, f: any): Promise<'added' | 'replaced' | 'unchanged' | 'kept_deleted'> {
  const ext = COPY_EXT(f.drive_file_id, a.projectId);
  const ledger = await env.DB.prepare('SELECT local_id FROM connector_fed_items WHERE integration_id = ? AND external_id = ?')
    .bind(a.integrationId, ext).first<{ local_id: number | null }>();
  if (ledger && ledger.local_id == null) return 'kept_deleted';
  const meta = await a.read('files.get', f.drive_file_id);
  if (meta?.trashed === true) throw new WorkspaceError('file_not_shared', 403);
  const modified = typeof meta?.modifiedTime === 'string' ? meta.modifiedTime : null;
  // Replaced only when Google says the file changed since the copy was made.
  if (ledger?.local_id != null && f.last_synced_at && modified && f.modified_time === modified) {
    await markRead(env, f.id, meta);
    return 'unchanged';
  }
  if (!env.FILES) throw new WorkspaceError('storage_not_configured');
  const native = String(meta?.mimeType || '').startsWith(NATIVE_PREFIX);
  const bytes: Uint8Array = native
    ? await a.read('files.export', f.drive_file_id, { mimeType: 'application/pdf', maxBytes: MAX_COPY_BYTES })
    : await a.read('alt=media', f.drive_file_id, { maxBytes: MAX_COPY_BYTES });
  const contentType = native ? 'application/pdf' : (MIME.test(String(meta?.mimeType || '')) ? String(meta.mimeType) : 'application/octet-stream');
  const base = (typeof meta?.name === 'string' && meta.name.trim() ? meta.name.trim() : String(f.name)).slice(0, 200);
  const name = native && !/\.pdf$/i.test(base) ? `${base}.pdf` : base;
  const project = await env.DB.prepare('SELECT id, uid FROM projects WHERE id = ?').bind(a.projectId).first<{ id: number; uid: string }>();
  if (!project?.uid) throw new WorkspaceError('project_not_available', 403);
  let storage;
  try { storage = await assertStorageRoom(env, { projectId: project.id }, bytes.byteLength, a.user); }
  catch (e) { if (e instanceof Response) throw new WorkspaceError('storage_full', 413); throw e; }
  const uid = crypto.randomUUID().replace(/-/g, '');
  // The R2 key is the venture's own: data-room/<project uid>/<file uid>.
  const key = `data-room/${project.uid}/${uid}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType }, customMetadata: { project_uid: project.uid, uploaded_by: String(a.user.id) } });
  const old = ledger?.local_id != null
    ? await env.DB.prepare('SELECT id, r2_key FROM data_room_files WHERE id = ? AND project_id = ?').bind(ledger.local_id, a.projectId).first<{ id: number; r2_key: string }>()
    : null;
  try {
    if (old) {
      await env.DB.batch([
        env.DB.prepare(`UPDATE data_room_files SET name = ?, r2_key = ?, content_type = ?, size_bytes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?`)
          .bind(name, key, contentType, bytes.byteLength, old.id, a.projectId),
        env.DB.prepare(LEDGER).bind(a.integrationId, a.projectId, 'data_room', 'drive_copy', ext, 'data_room_files', old.id),
      ]);
      await env.FILES.delete(old.r2_key).catch(() => {});
    } else {
      const ins = await env.DB.prepare(
        `INSERT INTO data_room_files (uid, project_id, folder_id, name, r2_key, content_type, size_bytes, visibility, uploaded_by_user_id,
           created_at, updated_at, access_tier, source_kind, source_ref)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, 'connector', 'google_drive')`,
      ).bind(uid, a.projectId, name, key, contentType, bytes.byteLength, COPY_ACCESS.visibility, a.user.id, COPY_ACCESS.access_tier).run();
      const id = Number(ins.meta?.last_row_id);
      await env.DB.prepare(LEDGER).bind(a.integrationId, a.projectId, 'data_room', 'drive_copy', ext, 'data_room_files', id).run();
    }
  } catch (e) {
    await env.FILES.delete(key).catch(() => {});
    throw e;
  }
  await noteStorageLanded(env, storage);
  await markRead(env, f.id, meta);
  await log(env, a.user, a.projectId, 'data-room', f.id, old ? 'google_copy_replaced' : 'file_uploaded', old ? 'File replaced from Google Drive' : 'File added from Google Drive; access nobody');
  return old ? 'replaced' : 'added';
}

const markRead = (env: Env, id: number, meta: any) => env.DB.prepare(
  `UPDATE google_workspace_files SET modified_time = COALESCE(?, modified_time), last_synced_at = CURRENT_TIMESTAMP, status = 'active', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
).bind(typeof meta?.modifiedTime === 'string' ? meta.modifiedTime : null, id).run();

/**
 * "Last met": for each prospect still in the pipeline, the latest past event in
 * the last 180 days with an attendee from the prospect's own firm domain (their
 * address, or their contact's). Proposed only when it is later than the last
 * meeting logged on the prospect.
 */
async function proposeLastMet(env: Env, a: { integrationId: number; projectId: number; eventDays: EventDays | null }, now: Date): Promise<number> {
  const prospects = (await env.DB.prepare(
    `SELECT p.id, p.email, c.email AS contact_email,
            (SELECT MAX(done_at) FROM raise_prospect_events ev WHERE ev.prospect_id = p.id AND ev.kind = 'meeting' AND ev.done_at IS NOT NULL) AS last_meeting
       FROM raise_prospects p LEFT JOIN contacts c ON c.id = p.contact_id AND c.project_id = p.project_id
      WHERE p.project_id = ? AND p.stage <> 'passed'`,
  ).bind(a.projectId).all<any>()).results || [];
  const byDomain = new Map<string, { id: number; last: string | null }[]>();
  for (const p of prospects) {
    for (const d of new Set([domainOf(p.email), domainOf(p.contact_email)])) {
      if (!d) continue;
      byDomain.set(d, [...(byDomain.get(d) || []), { id: Number(p.id), last: p.last_meeting ? String(p.last_meeting).slice(0, 10) : null }]);
    }
  }
  if (!byDomain.size || !a.eventDays) return 0; // nothing to match: the calendar is not read
  const to = now.toISOString();
  const from = new Date(now.getTime() - CALENDAR_DAYS * 86400000).toISOString();
  const { events } = await a.eventDays(from, to);
  const latest = new Map<number, string>();
  for (const e of events) {
    if (e.day > to.slice(0, 10)) continue;
    for (const d of e.domains) for (const p of byDomain.get(d) || []) {
      if (!latest.has(p.id) || e.day > latest.get(p.id)!) latest.set(p.id, e.day);
    }
  }
  let n = 0;
  for (const [prospectId, day] of latest) {
    const last = [...byDomain.values()].flat().find((p) => p.id === prospectId)?.last ?? null;
    if (last && last >= day) continue;
    const prefix = `met:${prospectId}:`;
    const json = JSON.stringify({ prospect_id: prospectId, day });
    await env.DB.batch([
      env.DB.prepare(WITHDRAW).bind(a.integrationId, a.projectId, prefix, prefix, prefix + day),
      env.DB.prepare(PROPOSE).bind(a.integrationId, a.projectId, 'capital_relationships', 'last_met', prefix + day, await sha256(json), `Last met ${day}`, json),
    ]);
    n += 1;
  }
  return n;
}

// ───────────────────────────────────────────────────────────── decide

export type Outcome = { ok: true; landed: { table: string; id: number } | null } | { ok: false; status: number; code: string; message: string };
const NOT_FOUND: Outcome = { ok: false, status: 404, code: 'proposal_not_found', message: 'That proposal is not here.' };
const DECIDED: Outcome = { ok: false, status: 409, code: 'proposal_decided', message: 'That proposal was already decided.' };
const RAISE_MODULES = ['pitch_deck', 'capital_relationships'];

/** Accept: claimed once (pending → accepted), then written to its module; a failure hands the claim back. */
export async function acceptRaiseGoogleProposal(env: Env, a: { integrationId: number; projectId: number; id: number; user: User }): Promise<Outcome> {
  const row = await env.DB.prepare(
    `SELECT id, module, kind, source_key, payload_json FROM google_workspace_proposals WHERE id = ? AND integration_id = ? AND project_id = ? AND module IN ('pitch_deck','capital_relationships')`,
  ).bind(a.id, a.integrationId, a.projectId).first<any>();
  if (!row || !RAISE_MODULES.includes(row.module)) return NOT_FOUND;
  const claimed = await env.DB.prepare(
    `UPDATE google_workspace_proposals SET status = 'accepted', decided_by = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`,
  ).bind(a.user.id, row.id).run();
  if (!claimed.meta?.changes) return DECIDED;
  const handBack = () => env.DB.prepare(`UPDATE google_workspace_proposals SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = ? AND status = 'accepted'`).bind(row.id).run();
  let p: any = {};
  try { p = JSON.parse(row.payload_json) ?? {}; } catch { p = {}; }
  try {
    if (row.kind === 'deck_version') {
      const slides = sanitizeSlides(Array.isArray(p.slides) ? p.slides : []);
      if (!slides.length) throw new WriterError(409, 'That deck has no slides to import.');
      const id = await insertVersion(env, a.projectId, slides, `From Google Slides: ${String(p.file_name || 'deck').slice(0, 100)}`, Number(a.user.id));
      await env.DB.prepare(LEDGER).bind(a.integrationId, a.projectId, 'pitch_deck', 'deck_version', DECK_EXT(String(p.file_id), a.projectId, String(p.modified_time ?? 'not-recorded')), 'pitch_decks', id).run();
      await log(env, a.user, a.projectId, 'pitch-deck', id, 'google_deck_imported', 'Deck version imported from Google Slides');
      return { ok: true, landed: { table: 'pitch_decks', id } };
    }
    if (row.kind === 'last_met') {
      const prospectId = Number(p.prospect_id); const day = String(p.day ?? '');
      if (!Number.isSafeInteger(prospectId) || !DAY.test(day)) throw new WriterError(409, 'That meeting is missing its investor or its day.');
      await logProspectEvent(env, { projectId: a.projectId, userId: Number(a.user.id), prospectId, body: { kind: 'meeting', on: day, note: 'Met, from Google Calendar' } });
      await env.DB.prepare(LEDGER).bind(a.integrationId, a.projectId, 'capital_relationships', 'last_met', MET_EXT(a.projectId, prospectId, day), 'raise_prospects', prospectId).run();
      return { ok: true, landed: { table: 'raise_prospects', id: prospectId } };
    }
    throw new WriterError(409, 'That proposal cannot be accepted here.');
  } catch (e) {
    await handBack();
    if (e instanceof WriterError) return { ok: false, status: e.status, code: 'accept_refused', message: e.sentence };
    throw e;
  }
}

/** Dismiss: pending → dismissed, once. A re-sync never proposes the same source again. */
export async function dismissRaiseGoogleProposal(env: Env, a: { integrationId: number; projectId: number; id: number; user: User }): Promise<Outcome> {
  const r = await env.DB.prepare(
    `UPDATE google_workspace_proposals SET status = 'dismissed', decided_by = ?, decided_at = CURRENT_TIMESTAMP
      WHERE id = ? AND integration_id = ? AND project_id = ? AND module IN ('pitch_deck','capital_relationships') AND status = 'pending'`,
  ).bind(a.user.id, a.id, a.integrationId, a.projectId).run();
  if (r.meta?.changes) return { ok: true, landed: null };
  const row = await env.DB.prepare(`SELECT 1 AS x FROM google_workspace_proposals WHERE id = ? AND integration_id = ? AND project_id = ? AND module IN ('pitch_deck','capital_relationships')`)
    .bind(a.id, a.integrationId, a.projectId).first();
  return row ? DECIDED : NOT_FOUND;
}

/** Delete a copy: the data-room file and its R2 object go; the ledger row stays without a `local_id`, so a re-sync never copies it again. */
export async function deleteRaiseGoogleCopy(env: Env, a: { integrationId: number; projectId: number; id: number; user: User }): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT f.id, f.r2_key FROM data_room_files f JOIN connector_fed_items l ON l.local_table = 'data_room_files' AND l.local_id = f.id
      WHERE f.id = ? AND f.project_id = ? AND l.integration_id = ? AND l.project_id = ?`,
  ).bind(a.id, a.projectId, a.integrationId, a.projectId).first<{ id: number; r2_key: string }>();
  if (!row) return false;
  await env.DB.batch([
    env.DB.prepare(`UPDATE connector_fed_items SET local_id = NULL WHERE integration_id = ? AND project_id = ? AND local_table = 'data_room_files' AND local_id = ?`).bind(a.integrationId, a.projectId, row.id),
    env.DB.prepare('DELETE FROM data_room_files WHERE id = ? AND project_id = ?').bind(row.id, a.projectId),
  ]);
  await env.FILES?.delete(row.r2_key).catch(() => {});
  await log(env, a.user, a.projectId, 'data-room', row.id, 'google_copy_deleted', 'Copy from Google Drive deleted; a sync leaves it deleted');
  return true;
}

// ───────────────────────────────────────────────────────────── the module's part

const SLUG_MODULE: Record<string, string> = Object.freeze({ 'pitch-deck': 'pitch_deck', 'data-room': 'data_room', 'capital-relationships': 'capital_relationships' });
export const RAISE_GOOGLE_SLUGS = Object.freeze(Object.keys(SLUG_MODULE));

/**
 * What Google fed one Raise module, for the member's own "From Google" section:
 * the files chosen for it, its pending proposals, and (Data room) the copies
 * with the day Google last changed each. Calendar proposals carry the
 * prospect's name, never an event's.
 */
export async function raiseGooglePart(env: Env, a: { integrationId: number; userId: number; projectId: number; slug: string }) {
  const module = SLUG_MODULE[a.slug];
  if (!module) return null;
  const files = module === 'capital_relationships' ? [] : ((await env.DB.prepare(
    `SELECT uid, kind, name, modified_time, last_synced_at, status, last_error FROM google_workspace_files
      WHERE integration_id = ? AND user_id = ? AND project_id = ? AND module = ? AND status <> 'stopped' ORDER BY id`,
  ).bind(a.integrationId, a.userId, a.projectId, module).all<any>()).results || []);
  const pending = ((await env.DB.prepare(
    `SELECT id, kind, title, payload_json FROM google_workspace_proposals WHERE integration_id = ? AND project_id = ? AND module = ? AND status = 'pending' ORDER BY id`,
  ).bind(a.integrationId, a.projectId, module).all<any>()).results || []);
  let next: number | null = null; let current: number | null = null;
  if (module === 'pitch_deck' && pending.length) {
    const v = await env.DB.prepare('SELECT MAX(version) AS v, MAX(CASE WHEN is_current = 1 THEN version END) AS c FROM pitch_decks WHERE project_id = ?').bind(a.projectId).first<{ v: number | null; c: number | null }>();
    next = (Number(v?.v) || 0) + 1; current = v?.c == null ? null : Number(v.c);
  }
  const names = new Map<number, string | null>();
  if (module === 'capital_relationships' && pending.length) {
    const rows = (await env.DB.prepare('SELECT id, name, firm FROM raise_prospects WHERE project_id = ?').bind(a.projectId).all<any>()).results || [];
    for (const r of rows) names.set(Number(r.id), r.name || r.firm || null);
  }
  const proposals = pending.map((r: any) => {
    let p: any = {};
    try { p = JSON.parse(r.payload_json) ?? {}; } catch { p = {}; }
    if (r.kind === 'deck_version') {
      return { id: r.id, kind: r.kind, title: `${r.title} as version ${next}?`, as_of: p.modified_time ?? null, version: next, current_version: current,
        slide_titles: (Array.isArray(p.slides) ? p.slides : []).map((s: any) => String(s?.title ?? '')), keeps: current == null ? null : `Version ${current} stays as it is. You can switch back to it at any time.` };
    }
    return { id: r.id, kind: r.kind, title: r.title, prospect_id: p.prospect_id ?? null, prospect: names.get(Number(p.prospect_id)) ?? null, day: p.day ?? null };
  });
  const copies = module !== 'data_room' ? [] : ((await env.DB.prepare(
    `SELECT f.id, f.uid, f.name, f.size_bytes, f.updated_at, g.modified_time
       FROM connector_fed_items l JOIN data_room_files f ON f.id = l.local_id AND l.local_table = 'data_room_files'
       LEFT JOIN google_workspace_files g ON g.integration_id = l.integration_id AND g.project_id = l.project_id AND g.module = 'data_room'
            AND l.external_id = g.drive_file_id || ':copy:' || g.project_id
      WHERE l.integration_id = ? AND l.project_id = ? AND l.module = 'data_room' ORDER BY f.id`,
  ).bind(a.integrationId, a.projectId).all<any>()).results || []).map((r: any) => ({ id: r.id, uid: r.uid, name: r.name, size_bytes: r.size_bytes, as_of: r.modified_time ?? null }));
  const deleted = module !== 'data_room' ? 0 : Number((await env.DB.prepare(
    // "Stop using" unlinks a copy too (D1091) but keeps it; only a deletion of a file still chosen counts.
    `SELECT COUNT(*) AS n FROM connector_fed_items l WHERE l.integration_id = ? AND l.project_id = ? AND l.module = 'data_room' AND l.local_id IS NULL
        AND EXISTS (SELECT 1 FROM google_workspace_files g WHERE g.integration_id = l.integration_id AND g.project_id = l.project_id AND g.module = 'data_room'
                     AND g.status <> 'stopped' AND l.external_id = g.drive_file_id || ':copy:' || g.project_id)`,
  ).bind(a.integrationId, a.projectId).first<{ n: number }>())?.n ?? 0);
  return { module, files, proposals, copies, deleted_kept: deleted };
}

async function log(env: Env, user: User, projectId: number, module: string, entityId: number | string, action: string, summary: string) {
  await logCycleWrite(env, { projectId, userId: Number(user.id), cycle: 'raise', module: module as any, entityId, action, summary }).catch(() => {});
}
