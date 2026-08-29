/**
 * Data room — folders, files, per-investor grants, and an NDA gate.
 *
 * Mounted at /api/data-room. Schema: migration 184.
 *
 * FOUNDER SIDE (owner of the project)
 *   GET    /:projectUid                       folders + files + grants + recent access
 *   POST   /:projectUid/folders               create
 *   PATCH  /:projectUid/folders/:uid          rename / re-file / change visibility
 *   DELETE /:projectUid/folders/:uid          delete (files inside are orphaned, not lost)
 *   POST   /:projectUid/files                 upload (base64 data URI → R2)
 *   PATCH  /:projectUid/files/:uid            rename / move / change visibility
 *   DELETE /:projectUid/files/:uid            delete row + object
 *   POST   /:projectUid/grants                open the room to an investor
 *   DELETE /:projectUid/grants/:uid           revoke
 *
 * INVESTOR SIDE (holder of a grant)
 *   GET    /shared                            rooms shared with me
 *   GET    /shared/:projectUid                the room as I may see it
 *   POST   /shared/:projectUid/files/:uid/download   one-time signed URL
 *
 * THE GATE. A file is `open` or `nda`. `open` needs an active grant. `nda`
 * needs an active grant AND an active row in `pairwise_ndas` between the
 * founder who granted access and the investor — the same table `esign.ts`
 * already writes, rather than a second NDA notion invented for this surface.
 *
 * WHAT THIS DOES NOT DO, and why:
 *
 *   * No watermarking. The canvas asks for watermarked downloads; there is no
 *     PDF pipeline in the worker. A download is instead per-investor,
 *     single-use, short-TTL and logged, and the UI says exactly that rather
 *     than implying a watermark nothing applies.
 *   * No "preview" distinct from download. Streaming bytes to a browser IS
 *     giving someone the file; a preview that pretended otherwise would be
 *     security theatre.
 *   * Nothing is listed that the caller may not open. An `nda` file does not
 *     appear as a locked row to an investor without an NDA — a filename is
 *     itself information ("Series B term sheet — Acme.pdf").
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { mapError, newUid, nowIso } from './_t13t14t15_helpers';
import { projectOwnerScope } from '../services/tenancyScope';
import { mintDownloadToken } from '../services/signedDownload';

const r = new Hono<{ Bindings: Env }>();

const VISIBILITY = new Set(['open', 'nda']);
const NAME_MAX = 200;
// A data room holds decks, models and signed PDFs. The cap is on the DECODED
// bytes: base64 inflates by 4/3, and the worker's request limit is the real
// ceiling above this.
const MAX_FILE_BYTES = 20 * 1024 * 1024;

type ProjectRow = { id: number; uid: string; name: string };
type GrantRow = {
  id: number; uid: string; project_id: number;
  investor_user_id: number; granted_by_user_id: number;
  status: string; expires_at: string | null; created_at: string;
};

/** The caller's project, or null. Ownership goes through the tenancy module. */
async function ownedProject(env: Env, user: any, projectUid: string): Promise<ProjectRow | null> {
  const scope = projectOwnerScope(user, 'p');
  const row = await env.DB.prepare(
    `SELECT p.id, p.uid, p.name FROM projects p WHERE p.uid = ? AND ${scope.sql}`,
  ).bind(projectUid, ...scope.binds).first<ProjectRow>();
  return row || null;
}

/** An active, unexpired grant for this investor on this project, or null. */
async function activeGrant(env: Env, projectId: number, userId: number): Promise<GrantRow | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM data_room_grants
      WHERE project_id = ? AND investor_user_id = ? AND status = 'active'
        AND (expires_at IS NULL OR expires_at > datetime('now'))`,
  ).bind(projectId, userId).first<GrantRow>();
  return row || null;
}

/**
 * Whether the NDA between the granting founder and this investor is live.
 *
 * Migration 025 fixes party_a as the founder and party_b as the investor, and
 * the seeder enforces it so the UNIQUE constraint works — so this is a direct
 * two-column lookup rather than an OR over both orderings. Checking both ways
 * round would quietly accept a row the rest of the system considers malformed.
 */
async function ndaActive(env: Env, founderUserId: number, investorUserId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 FROM pairwise_ndas
      WHERE party_a_user_id = ? AND party_b_user_id = ? AND status = 'active'
        AND (valid_until IS NULL OR valid_until > datetime('now'))`,
  ).bind(founderUserId, investorUserId).first();
  return !!row;
}

async function logAccess(env: Env, projectId: number, userId: number, action: string, fileId: number | null) {
  try {
    await env.DB.prepare(
      `INSERT INTO data_room_access_log (project_id, file_id, user_id, action, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(projectId, fileId, userId, action, nowIso()).run();
  } catch (e) {
    // The log is evidence, not a gate: a failed insert must not deny a
    // download the caller is entitled to. It is loud in the tail instead.
    console.error('[data_room] access log insert failed', e);
  }
}

function badVisibility(v: unknown): boolean {
  return v !== undefined && !VISIBILITY.has(String(v));
}

/* ------------------------------------------------------------------ *
 * Investor side — registered FIRST so `/shared` is not swallowed by    *
 * `/:projectUid`. Hono matches in declaration order.                   *
 * ------------------------------------------------------------------ */

r.get('/shared', async (c) => {
  try {
    const user = await requireAuth(c);
    const rows = await c.env.DB.prepare(
      `SELECT g.uid AS grant_uid, g.created_at, g.expires_at,
              p.uid AS project_uid, p.name AS project_name,
              (SELECT COUNT(*) FROM data_room_files f WHERE f.project_id = g.project_id) AS file_count
         FROM data_room_grants g
         JOIN projects p ON p.id = g.project_id
        WHERE g.investor_user_id = ? AND g.status = 'active'
          AND (g.expires_at IS NULL OR g.expires_at > datetime('now'))
        ORDER BY g.created_at DESC`,
    ).bind(user.id).all<any>();
    return c.json({ items: rows.results || [] });
  } catch (e) { return mapError(c, e); }
});

r.get('/shared/:projectUid', async (c) => {
  try {
    const user = await requireAuth(c);
    const project = await c.env.DB.prepare('SELECT id, uid, name FROM projects WHERE uid = ?')
      .bind(c.req.param('projectUid')).first<ProjectRow>();
    // A project with no grant and a project that does not exist answer the
    // same way. Distinguishing them tells an investor which companies are on
    // the platform.
    const grant = project ? await activeGrant(c.env, project.id, user.id) : null;
    if (!project || !grant) return c.json({ detail: 'Data room not found' }, 404);

    const nda = await ndaActive(c.env, grant.granted_by_user_id, user.id);
    const folders = await c.env.DB.prepare(
      `SELECT uid, name, parent_id, id, visibility, display_order
         FROM data_room_folders WHERE project_id = ? ORDER BY display_order, name`,
    ).bind(project.id).all<any>();
    const files = await c.env.DB.prepare(
      `SELECT uid, name, folder_id, content_type, size_bytes, visibility, created_at
         FROM data_room_files WHERE project_id = ? ORDER BY name`,
    ).bind(project.id).all<any>();

    const visible = (v: string) => v === 'open' || nda;
    // Filenames are withheld, not greyed out — see the header note.
    const openFiles = (files.results || []).filter((f) => visible(f.visibility));
    const openFolders = (folders.results || []).filter((f) => visible(f.visibility));
    const withheld = (files.results || []).length - openFiles.length;

    await logAccess(c.env, project.id, user.id, 'open_room', null);
    return c.json({
      project: { uid: project.uid, name: project.name },
      nda_signed: nda,
      folders: openFolders.map(({ id, ...rest }) => rest),
      files: openFiles.map((f) => ({ ...f, folder_uid: folderUid(folders.results || [], f.folder_id) })),
      // A count, never the names. The investor is told something is behind the
      // NDA so the gate is not invisible; what it is stays private.
      withheld_behind_nda: withheld,
    });
  } catch (e) { return mapError(c, e); }
});

function folderUid(folders: any[], folderId: number | null): string | null {
  if (folderId == null) return null;
  const f = folders.find((x) => x.id === folderId);
  return f ? f.uid : null;
}

r.post('/shared/:projectUid/files/:uid/download', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!c.env.FILES) return c.json({ detail: 'storage_not_configured' }, 503);
    const project = await c.env.DB.prepare('SELECT id, uid, name FROM projects WHERE uid = ?')
      .bind(c.req.param('projectUid')).first<ProjectRow>();
    const grant = project ? await activeGrant(c.env, project.id, user.id) : null;
    if (!project || !grant) return c.json({ detail: 'Data room not found' }, 404);

    const file = await c.env.DB.prepare(
      'SELECT id, uid, name, r2_key, visibility FROM data_room_files WHERE uid = ? AND project_id = ?',
    ).bind(c.req.param('uid'), project.id).first<any>();
    if (!file) return c.json({ detail: 'File not found' }, 404);

    // The gate is re-checked HERE, not inherited from the listing. A uid
    // captured while an NDA was live must stop working when it lapses.
    if (file.visibility === 'nda' && !(await ndaActive(c.env, grant.granted_by_user_id, user.id))) {
      return c.json({ detail: 'This file requires a signed NDA' }, 403);
    }

    const { token, expires_at } = await mintDownloadToken(c.env, {
      key: file.r2_key,
      audience: `data_room:${project.uid}`,
      userId: user.id,
      ttlSec: 120,
    });
    await logAccess(c.env, project.id, user.id, 'download', file.id);
    return c.json({ url: `/api/files/dl/${token}`, expires_at, name: file.name });
  } catch (e) { return mapError(c, e); }
});

/* ------------------------------------------------------------------ *
 * Founder side                                                         *
 * ------------------------------------------------------------------ */

r.get('/:projectUid', async (c) => {
  try {
    const user = await requireAuth(c);
    const project = await ownedProject(c.env, user, c.req.param('projectUid'));
    if (!project) return c.json({ detail: 'Project not found' }, 404);

    const folders = await c.env.DB.prepare(
      `SELECT id, uid, name, parent_id, visibility, display_order
         FROM data_room_folders WHERE project_id = ? ORDER BY display_order, name`,
    ).bind(project.id).all<any>();
    const files = await c.env.DB.prepare(
      `SELECT id, uid, name, folder_id, content_type, size_bytes, visibility, created_at
         FROM data_room_files WHERE project_id = ? ORDER BY name`,
    ).bind(project.id).all<any>();
    const grants = await c.env.DB.prepare(
      `SELECT g.uid, g.status, g.created_at, g.expires_at,
              u.email AS investor_email, u.name AS investor_name,
              EXISTS (
                SELECT 1 FROM pairwise_ndas n
                 WHERE n.party_a_user_id = g.granted_by_user_id
                   AND n.party_b_user_id = g.investor_user_id
                   AND n.status = 'active'
                   AND (n.valid_until IS NULL OR n.valid_until > datetime('now'))
              ) AS nda_signed
         FROM data_room_grants g
         JOIN users u ON u.id = g.investor_user_id
        WHERE g.project_id = ? ORDER BY g.created_at DESC`,
    ).bind(project.id).all<any>();
    const access = await c.env.DB.prepare(
      `SELECT l.action, l.created_at, u.email AS user_email, f.name AS file_name
         FROM data_room_access_log l
         JOIN users u ON u.id = l.user_id
         LEFT JOIN data_room_files f ON f.id = l.file_id
        WHERE l.project_id = ? ORDER BY l.created_at DESC LIMIT 50`,
    ).bind(project.id).all<any>();

    return c.json({
      project: { uid: project.uid, name: project.name },
      folders: folders.results || [],
      files: files.results || [],
      grants: (grants.results || []).map((g) => ({ ...g, nda_signed: !!g.nda_signed })),
      recent_access: access.results || [],
    });
  } catch (e) { return mapError(c, e); }
});

r.post('/:projectUid/folders', async (c) => {
  try {
    const user = await requireAuth(c);
    const project = await ownedProject(c.env, user, c.req.param('projectUid'));
    if (!project) return c.json({ detail: 'Project not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));
    const name = String(body.name || '').trim();
    if (!name) return c.json({ detail: 'name is required' }, 400);
    if (badVisibility(body.visibility)) return c.json({ detail: 'invalid visibility' }, 400);

    // A parent must belong to the SAME project, or a folder could be re-homed
    // into another founder's tree by uid.
    let parentId: number | null = null;
    if (body.parent_uid) {
      const parent = await c.env.DB.prepare(
        'SELECT id FROM data_room_folders WHERE uid = ? AND project_id = ?',
      ).bind(String(body.parent_uid), project.id).first<{ id: number }>();
      if (!parent) return c.json({ detail: 'Parent folder not found' }, 404);
      parentId = parent.id;
    }

    const uid = newUid();
    await c.env.DB.prepare(
      `INSERT INTO data_room_folders
         (uid, project_id, parent_id, name, visibility, display_order, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uid, project.id, parentId, name.slice(0, NAME_MAX),
           body.visibility ? String(body.visibility) : 'open',
           Number(body.display_order) || 0, user.id, nowIso(), nowIso()).run();
    return c.json({ uid }, 201);
  } catch (e) { return mapError(c, e); }
});

r.patch('/:projectUid/folders/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const project = await ownedProject(c.env, user, c.req.param('projectUid'));
    if (!project) return c.json({ detail: 'Project not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));
    if (badVisibility(body.visibility)) return c.json({ detail: 'invalid visibility' }, 400);

    const sets: string[] = []; const params: any[] = [];
    if (body.name !== undefined) { sets.push('name = ?'); params.push(String(body.name).slice(0, NAME_MAX)); }
    if (body.visibility !== undefined) { sets.push('visibility = ?'); params.push(String(body.visibility)); }
    if (body.display_order !== undefined) { sets.push('display_order = ?'); params.push(Number(body.display_order) || 0); }
    if (!sets.length) return c.json({ detail: 'nothing to update' }, 400);
    sets.push('updated_at = ?'); params.push(nowIso());

    // project_id in the WHERE, not just the uid: the uid alone would let one
    // founder patch another's folder.
    const res = await c.env.DB.prepare(
      `UPDATE data_room_folders SET ${sets.join(', ')} WHERE uid = ? AND project_id = ?`,
    ).bind(...params, c.req.param('uid'), project.id).run();
    if (!(res as any).meta?.changes) return c.json({ detail: 'Folder not found' }, 404);
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

r.delete('/:projectUid/folders/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const project = await ownedProject(c.env, user, c.req.param('projectUid'));
    if (!project) return c.json({ detail: 'Project not found' }, 404);
    const res = await c.env.DB.prepare(
      'DELETE FROM data_room_folders WHERE uid = ? AND project_id = ?',
    ).bind(c.req.param('uid'), project.id).run();
    if (!(res as any).meta?.changes) return c.json({ detail: 'Folder not found' }, 404);
    // Migration 184 sets data_room_files.folder_id ON DELETE SET NULL, so the
    // files land at the room root rather than disappearing with the folder.
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

r.post('/:projectUid/files', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!c.env.FILES) return c.json({ detail: 'storage_not_configured' }, 503);
    const project = await ownedProject(c.env, user, c.req.param('projectUid'));
    if (!project) return c.json({ detail: 'Project not found' }, 404);

    const body = await c.req.json().catch(() => ({} as any));
    const name = String(body.name || '').trim();
    if (!name) return c.json({ detail: 'name is required' }, 400);
    if (badVisibility(body.visibility)) return c.json({ detail: 'invalid visibility' }, 400);

    const dataUri = String(body.data || '');
    const comma = dataUri.indexOf(',');
    if (!dataUri.startsWith('data:') || comma < 0) {
      return c.json({ detail: 'data must be a base64 data URI' }, 400);
    }
    const declaredMime = dataUri.slice(5, dataUri.indexOf(';')) || 'application/octet-stream';
    let bytes: Uint8Array;
    try {
      const bin = atob(dataUri.slice(comma + 1));
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch { return c.json({ detail: 'invalid base64' }, 400); }
    if (bytes.byteLength > MAX_FILE_BYTES) {
      return c.json({ detail: 'too_large', max_bytes: MAX_FILE_BYTES }, 413);
    }

    let folderId: number | null = null;
    if (body.folder_uid) {
      const folder = await c.env.DB.prepare(
        'SELECT id FROM data_room_folders WHERE uid = ? AND project_id = ?',
      ).bind(String(body.folder_uid), project.id).first<{ id: number }>();
      if (!folder) return c.json({ detail: 'Folder not found' }, 404);
      folderId = folder.id;
    }

    // The key is derived, never taken from the request: a caller-supplied key
    // is a path-traversal write into another project's prefix.
    const uid = newUid();
    const key = `data-room/${project.uid}/${uid}`;
    await c.env.FILES.put(key, bytes, {
      httpMetadata: { contentType: declaredMime },
      customMetadata: { project_uid: project.uid, uploaded_by: String(user.id) },
    });

    await c.env.DB.prepare(
      `INSERT INTO data_room_files
         (uid, project_id, folder_id, name, r2_key, content_type, size_bytes,
          visibility, uploaded_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uid, project.id, folderId, name.slice(0, NAME_MAX), key, declaredMime,
           bytes.byteLength, body.visibility ? String(body.visibility) : 'open',
           user.id, nowIso(), nowIso()).run();
    return c.json({ uid, size_bytes: bytes.byteLength }, 201);
  } catch (e) { return mapError(c, e); }
});

r.patch('/:projectUid/files/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const project = await ownedProject(c.env, user, c.req.param('projectUid'));
    if (!project) return c.json({ detail: 'Project not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));
    if (badVisibility(body.visibility)) return c.json({ detail: 'invalid visibility' }, 400);

    const sets: string[] = []; const params: any[] = [];
    if (body.name !== undefined) { sets.push('name = ?'); params.push(String(body.name).slice(0, NAME_MAX)); }
    if (body.visibility !== undefined) { sets.push('visibility = ?'); params.push(String(body.visibility)); }
    if (body.folder_uid !== undefined) {
      if (body.folder_uid === null) { sets.push('folder_id = ?'); params.push(null); }
      else {
        const folder = await c.env.DB.prepare(
          'SELECT id FROM data_room_folders WHERE uid = ? AND project_id = ?',
        ).bind(String(body.folder_uid), project.id).first<{ id: number }>();
        if (!folder) return c.json({ detail: 'Folder not found' }, 404);
        sets.push('folder_id = ?'); params.push(folder.id);
      }
    }
    if (!sets.length) return c.json({ detail: 'nothing to update' }, 400);
    sets.push('updated_at = ?'); params.push(nowIso());

    const res = await c.env.DB.prepare(
      `UPDATE data_room_files SET ${sets.join(', ')} WHERE uid = ? AND project_id = ?`,
    ).bind(...params, c.req.param('uid'), project.id).run();
    if (!(res as any).meta?.changes) return c.json({ detail: 'File not found' }, 404);
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

r.delete('/:projectUid/files/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const project = await ownedProject(c.env, user, c.req.param('projectUid'));
    if (!project) return c.json({ detail: 'Project not found' }, 404);
    const file = await c.env.DB.prepare(
      'SELECT id, r2_key FROM data_room_files WHERE uid = ? AND project_id = ?',
    ).bind(c.req.param('uid'), project.id).first<{ id: number; r2_key: string }>();
    if (!file) return c.json({ detail: 'File not found' }, 404);

    // Row first. A deleted object with a surviving row is a broken download;
    // a surviving object with no row is unreachable, which is merely waste.
    await c.env.DB.prepare('DELETE FROM data_room_files WHERE id = ?').bind(file.id).run();
    if (c.env.FILES && file.r2_key.startsWith(`data-room/${project.uid}/`)) {
      try { await c.env.FILES.delete(file.r2_key); }
      catch (e) { console.error('[data_room] R2 delete failed', e); }
    }
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

r.post('/:projectUid/grants', async (c) => {
  try {
    const user = await requireAuth(c);
    const project = await ownedProject(c.env, user, c.req.param('projectUid'));
    if (!project) return c.json({ detail: 'Project not found' }, 404);
    const body = await c.req.json().catch(() => ({} as any));
    const email = String(body.email || '').trim().toLowerCase();
    if (!email) return c.json({ detail: 'email is required' }, 400);

    // Resolves to an EXISTING account. No invitation is sent and no row is
    // written for an unknown address — the UI says so rather than implying an
    // invite flow that does not exist.
    const investor = await c.env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = ?')
      .bind(email).first<{ id: number }>();
    if (!investor) return c.json({ detail: 'No account with that address' }, 404);
    if (investor.id === user.id) return c.json({ detail: 'You already own this room' }, 400);

    const uid = newUid();
    // Re-granting a revoked investor reactivates the existing row rather than
    // failing on the UNIQUE(project_id, investor_user_id) constraint.
    await c.env.DB.prepare(
      `INSERT INTO data_room_grants
         (uid, project_id, investor_user_id, granted_by_user_id, status, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
       ON CONFLICT (project_id, investor_user_id) DO UPDATE SET
         status = 'active', granted_by_user_id = excluded.granted_by_user_id,
         expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
    ).bind(uid, project.id, investor.id, user.id,
           body.expires_at ? String(body.expires_at) : null, nowIso(), nowIso()).run();
    return c.json({ ok: true }, 201);
  } catch (e) { return mapError(c, e); }
});

r.delete('/:projectUid/grants/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    const project = await ownedProject(c.env, user, c.req.param('projectUid'));
    if (!project) return c.json({ detail: 'Project not found' }, 404);
    // Revoked, not deleted: the access log points at a user whose grant is
    // gone, and the founder still needs to read what that investor opened.
    const res = await c.env.DB.prepare(
      `UPDATE data_room_grants SET status = 'revoked', updated_at = ?
        WHERE uid = ? AND project_id = ?`,
    ).bind(nowIso(), c.req.param('uid'), project.id).run();
    if (!(res as any).meta?.changes) return c.json({ detail: 'Grant not found' }, 404);
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

export default r;
