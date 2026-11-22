/**
 * D8260 (#8260, Build v2 BD25): Company creation's two hand-offs, for the company's members only.
 * Mounted at /api/cycles/build, ahead of `cycle_build.ts`'s router.
 *
 *   GET  /company-creation/filings/export?project=<id>  the filings table as CSV, with each proof's link
 *   GET  /company-creation/data-room?project=<id>       the four papers, stored ones not yet in the room preselected
 *   POST /company-creation/data-room?project=<id>       { kinds: [...] } copies those papers into the venture's room
 *
 * WHO. The venture's board gate first (`context`, as every Build read), then membership of the
 * venture's company (`viewerIsMember`, which admits an admin), as the papers block reads them
 * (D6038). A venture with no company is 409 `company_not_linked`; anyone else is 403
 * `company_members_only` and is told nothing about the company. Adding to the room also needs the
 * room's own upload right (`roomProject` + `roomCan(..., 'upload')`, D1103): the owner or a
 * co-founder. An admin is refused there, as on every founder-side room write.
 *
 * THE EXPORT is the module page's own rows (`company()`), every one, with the page's columns and a
 * "Proof link". The link opens the filing in the app, where Open proof mints its one-time download
 * (D690): a download token never goes into a file. A filing with no stored proof reads Not recorded
 * in that column, as every empty cell in a Build export does (D6043). Cells pass `csvCell`, so a
 * value that starts like a formula is written as text.
 *
 * THE ROOM COPY. Each chosen paper's bytes are copied under a fresh `data-room/<venture uid>/<uid>`
 * key (a record, D6651), never shared with the company document's object, so removing it from the
 * room leaves the company's paper whole. The row is filed as the cap table and use-of-funds
 * snapshots are: under NDA, `access_tier` nobody, seen by no investor until the founder shares it.
 * `source_ref` is `company_document:<document uid>`, which is how a paper already in the room is
 * known and skipped. Each row and its activity line are one batch; if it fails, the object just
 * stored is erased as `unreferenced`. No new store, no migration.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { stripTrailingSlashes } from '../util/url';
import { csvCell } from '../services/capTableRegister';
import { csvResponse, stamp } from '../services/csv';
import { viewerIsMember } from '../services/companyAccess';
import { assertStorageRoom, noteStorageLanded } from '../services/storageRoom';
import { putRecord } from '../services/recordStore';
import { eraseRecordObjects } from '../services/recordErasure';
import { logCycleWriteStatement } from '../services/cycleActivity';
import { roomCan } from '../services/dataRoomCapabilities';
import { roomProject } from './data_room';
import { KIND_LABELS, SLOT_KINDS, pointerOf } from './company_documents';
import cycleBuild, { company, context } from './cycle_build';

const r = new Hono<{ Bindings: Env }>();

type Project = Exclude<Awaited<ReturnType<typeof context>>, Response>;

const NOT_RECORDED = 'Not recorded';
/** The export's columns: the page's five, then the proof's link. */
export const EXPORT_COLUMNS = Object.freeze([
  ['filing', 'Filing'], ['jurisdiction', 'Jurisdiction'], ['due', 'Due'], ['state', 'State'], ['proof', 'Proof'], ['proof_link', 'Proof link'],
] as const);

const NOT_LINKED = { code: 'company_not_linked', message: 'Link this venture to its company first.' };
const MEMBERS_ONLY = { code: 'company_members_only', message: 'Only the company’s members can do this.' };

/** The venture and its company, for a member of that company only; otherwise the refusal to send. */
async function memberContext(c: any): Promise<{ project: Project; user: Awaited<ReturnType<typeof requireAuth>> } | Response> {
  const project = await context(c);
  if (project instanceof Response) return project;
  const user = await requireAuth(c);
  if (project.company_id == null) return refuse(c, 409, NOT_LINKED);
  if (!(await viewerIsMember(c.env, project.company_id, user))) return refuse(c, 403, MEMBERS_ONLY);
  return { project, user };
}

const cellText = (cell: unknown): string => {
  const t = cell == null ? '' : typeof cell === 'object' ? String((cell as { text?: unknown }).text ?? '') : String(cell);
  return t === '' ? NOT_RECORDED : t;
};

/** The link that opens a filing in the app, or null when it holds no stored proof. */
export function proofLink(origin: string, projectId: number, rowId: string, proof: unknown): string | null {
  if (proof !== 'Stored' || !/^(step|obligation)-\d+$/.test(rowId)) return null;
  return `${origin}/build/company-creation/${rowId}?project_id=${projectId}`;
}

r.get('/company-creation/filings/export', async (c) => {
  const ctx = await memberContext(c);
  if (ctx instanceof Response) return ctx;
  const read = await company(c.env, ctx.project, ctx.user, { parts: false, rows: true } as Parameters<typeof company>[3]);
  const origin = stripTrailingSlashes(c.env.APP_URL || 'https://axal.vc');
  const lines = [EXPORT_COLUMNS.map(([, label]) => csvCell(label)).join(',')];
  for (const row of read.rows) {
    const cells = row.cells as Record<string, unknown>;
    const link = proofLink(origin, ctx.project.id, String(row.id), cells.proof);
    lines.push(EXPORT_COLUMNS.map(([key]) => csvCell(key === 'proof_link' ? (link ?? NOT_RECORDED) : cellText(cells[key]))).join(','));
  }
  return csvResponse(lines.join('\r\n'), `company-filings-${ctx.project.id}-${stamp()}.csv`, { 'Cache-Control': 'no-store', 'X-Export-Rows': String(read.rows.length) });
});

type Paper = { kind: string; label: string; state: 'Stored' | 'Missing' | 'Unreadable'; document_uid: string | null; in_room: boolean; preselected: boolean };

/** The four papers, each with whether it is already in the venture's room. */
async function papers(env: Env, companyId: number, projectId: number): Promise<{ list: Paper[]; pointers: Map<string, { r2_key: string; content_type: string; title: string }> }> {
  const rows = (await env.DB.prepare(
    `SELECT d.uid, d.doc_type, d.title, d.content FROM documents d
      WHERE d.company_id = ? AND d.project_id IS NULL AND d.doc_type IN (?, ?, ?, ?)
      ORDER BY d.created_at DESC, d.id DESC`,
  ).bind(companyId, ...SLOT_KINDS).all<{ uid: string; doc_type: string; title: string; content: string | null }>()).results ?? [];
  const inRoom = new Set(((await env.DB.prepare(
    `SELECT source_ref FROM data_room_files WHERE project_id = ? AND source_ref LIKE 'company_document:%'`,
  ).bind(projectId).all<{ source_ref: string }>()).results ?? []).map(x => x.source_ref.slice('company_document:'.length)));
  const pointers = new Map<string, { r2_key: string; content_type: string; title: string }>();
  const list = SLOT_KINDS.map((kind): Paper => {
    const doc = rows.find(x => x.doc_type === kind) ?? null;
    const pointer = doc ? pointerOf(doc.content) : null;
    if (doc && pointer) pointers.set(kind, { ...pointer, title: doc.title });
    const state = doc == null ? 'Missing' : pointer ? 'Stored' : 'Unreadable';
    const already = doc != null && inRoom.has(doc.uid);
    return { kind, label: KIND_LABELS[kind], state, document_uid: doc?.uid ?? null, in_room: already, preselected: state === 'Stored' && !already };
  });
  return { list, pointers };
}

async function roomOf(c: any, user: any, projectId: number) {
  const p = await c.env.DB.prepare('SELECT uid FROM projects WHERE id = ?').bind(projectId).first();
  const room = p?.uid ? await roomProject(c, user, String(p.uid)) : null;
  return room && roomCan(room.role, 'upload', user) ? room : null;
}

r.get('/company-creation/data-room', async (c) => {
  const ctx = await memberContext(c);
  if (ctx instanceof Response) return ctx;
  try {
    const { list } = await papers(c.env, ctx.project.company_id!, ctx.project.id);
    const room = await roomOf(c, ctx.user, ctx.project.id);
    return c.json({ papers: list, can_add: room != null,
      reason: room ? null : 'Only the venture’s owner or a co-founder adds papers to its data room.' });
  } catch (error) {
    console.error('[company-creation] data room papers read failed', (error as Error)?.message);
    return refuse(c, 503, { code: 'papers_unreadable', message: 'The company’s papers could not be read. Nothing was changed.' });
  }
});

r.post('/company-creation/data-room', async (c) => {
  const ctx = await memberContext(c);
  if (ctx instanceof Response) return ctx;
  const body = await c.req.json().catch(() => null) as { kinds?: unknown } | null;
  const kinds = Array.isArray(body?.kinds) ? [...new Set(body!.kinds.map(String))] : null;
  if (!kinds || !kinds.length || kinds.some(k => !(SLOT_KINDS as readonly string[]).includes(k))) {
    return refuse(c, 400, { code: 'invalid_papers', message: 'Choose one or more of the four papers.' });
  }
  const room = await roomOf(c, ctx.user, ctx.project.id);
  if (!room) return refuse(c, 403, { code: 'room_upload_denied', message: 'Only the venture’s owner or a co-founder adds papers to its data room.' });
  if (!c.env.FILES) return refuse(c, 503, { code: 'storage_not_configured', message: 'The data room’s storage is not configured here.' });
  let read;
  try { read = await papers(c.env, ctx.project.company_id!, ctx.project.id); } catch {
    return refuse(c, 503, { code: 'papers_unreadable', message: 'The company’s papers could not be read. Nothing was changed.' });
  }
  const added: Array<{ kind: string; file_uid: string; name: string }> = [];
  const skipped: Array<{ kind: string; reason: string }> = [];
  for (const kind of kinds) {
    const paper = read.list.find(p => p.kind === kind)!;
    const pointer = read.pointers.get(kind);
    if (paper.in_room) { skipped.push({ kind, reason: 'Already in the data room.' }); continue; }
    if (paper.state !== 'Stored' || !pointer) { skipped.push({ kind, reason: paper.state === 'Missing' ? 'Not stored yet.' : 'The stored file could not be read.' }); continue; }
    const obj = await c.env.FILES.get(pointer.r2_key);
    if (!obj) { skipped.push({ kind, reason: 'The stored file could not be read.' }); continue; }
    const bytes = new Uint8Array(await obj.arrayBuffer());
    const uid = crypto.randomUUID().replace(/-/g, '');
    const key = `data-room/${room.project.uid}/${uid}`;
    const ext = pointer.content_type === 'application/pdf' ? 'pdf' : pointer.content_type === 'image/png' ? 'png' : 'jpg';
    const name = `${(pointer.title || paper.label).replace(/[^A-Za-z0-9 ._()-]+/g, '').trim().slice(0, 120) || paper.label}.${ext}`;
    let storage: Awaited<ReturnType<typeof assertStorageRoom>>;
    try { storage = await assertStorageRoom(c.env, { projectId: ctx.project.id }, bytes.byteLength, ctx.user as any); } catch (e) { if (e instanceof Response) return e; throw e; }
    const stored = await putRecord(c.env.FILES, key, bytes, { httpMetadata: { contentType: pointer.content_type }, customMetadata: { project_uid: String(room.project.uid), uploaded_by: String(ctx.user.id) } });
    if (!stored.ok) { skipped.push({ kind, reason: 'It could not be copied. Try again in a moment.' }); continue; }
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(`INSERT INTO data_room_files (uid, project_id, folder_id, name, r2_key, content_type, size_bytes, visibility, uploaded_by_user_id,
             created_at, updated_at, access_tier, source_kind, source_ref)
           VALUES (?, ?, NULL, ?, ?, ?, ?, 'nda', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'nobody', 'document', ?)`)
          .bind(uid, ctx.project.id, name, key, pointer.content_type, bytes.byteLength, ctx.user.id, `company_document:${paper.document_uid}`),
        logCycleWriteStatement(c.env, { projectId: ctx.project.id, userId: ctx.user.id, cycle: 'build', module: 'company-creation', entityId: null,
          action: 'build_paper_to_data_room', summary: `Added ${paper.label} to the data room, under NDA, shared with nobody.` }),
      ]);
    } catch (e) {
      console.error('[company-creation] paper not filed', (e as Error)?.name);
      await eraseRecordObjects(c.env.FILES, key, 'unreferenced', { db: c.env.DB }).catch(() => {});
      skipped.push({ kind, reason: 'It could not be added. Try again in a moment.' });
      continue;
    }
    await noteStorageLanded(c.env, storage);
    added.push({ kind, file_uid: uid, name });
  }
  return c.json({ added, skipped, where: 'Data room, under NDA, shared with nobody until you share it.' }, added.length ? 201 : 200);
});

export default r;
export const mount: RouteMount = { path: '/api/cycles/build', router: r, before: [cycleBuild] };
