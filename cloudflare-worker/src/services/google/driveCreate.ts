import type { Env } from '../../types';
import { loadRefreshTokenExport, refreshGoogleAccessToken, reencryptRefreshTokenExport } from '../calendar';
import { WorkspaceError, validFileId, workspaceConnection } from './workspace';

/**
 * D904 (#2683) — the one write made with the member's Google Workspace grant:
 * creating a new file in their Drive, the presentation they exported. The
 * owner chose it on 2026-10-27 (#2434 question 2, A) as the single exception
 * to D1091's read-only Workspace. (The Super Admin Research Sheets writer in
 * `fundSheets.ts` is separate: its own grant and store, D1091.)
 *
 * ONE CALL, NOTHING ELSE. `GOOGLE_WORKSPACE_WRITES` names exactly one request:
 * POST to Drive's upload endpoint with no file id in the path, so it can only
 * create. There is no update, copy, delete or permission call, no `parents`
 * (the file lands in the member's My Drive) and no sharing. Under
 * `drive.file`, Google lets the app reach only files it created or the member
 * chose, so this grant cannot read or change anything else.
 *
 * The metadata asks Drive to convert the PowerPoint into a Google Slides
 * presentation. UNVERIFIED until the owner's first live export: if Drive keeps
 * it as PowerPoint, the answer says so (`converted: false`) rather than
 * claiming a Slides deck. A multipart upload carries at most 5 MB; a larger
 * file is refused before any call. Bounded answer, no redirects, ten seconds,
 * error codes only: a provider body never becomes an error or a log line.
 */
export const GOOGLE_WORKSPACE_WRITES = Object.freeze({
  'files.create': Object.freeze({ method: 'POST', origin: 'https://www.googleapis.com', path: '/upload/drive/v3/files' }),
});
export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const SLIDES_MIME = 'application/vnd.google-apps.presentation';
/** Drive's limit for a multipart upload. */
export const DRIVE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
const ANSWER_MAX_BYTES = 64 * 1024;

export type CreatedPresentation = { file_id: string; converted: boolean; url: string };

/** The address the founder opens: Slides for a converted deck, Drive's viewer for a file Drive kept as PowerPoint. */
export const presentationUrl = (id: string, converted: boolean) =>
  converted ? `https://docs.google.com/presentation/d/${id}/edit` : `https://drive.google.com/file/d/${id}/view`;

/** A file name Drive shows: the deck's title and version, no control characters, at most 120 characters. */
export function driveName(title: string, version: number | null): string {
  const t = String(title || 'Pitch deck').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Pitch deck';
  return version == null ? t : `${t} · v${version}`;
}

function multipartBody(name: string, bytes: Uint8Array, boundary: string): Uint8Array {
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, mimeType: SLIDES_MIME })}\r\n`
    + `--${boundary}\r\nContent-Type: ${PPTX_MIME}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const out = new Uint8Array(head.length + bytes.length + tail.length);
  out.set(head, 0); out.set(bytes, head.length); out.set(tail, head.length + bytes.length);
  return out;
}

/** Create the exported presentation in the member's Drive; the file's id, whether Drive converted it, and where it opens. */
export async function createPresentation(env: Env, userId: number, file: { name: string; bytes: Uint8Array }, fetcher: typeof fetch = fetch): Promise<CreatedPresentation> {
  if (file.bytes.length > DRIVE_UPLOAD_MAX_BYTES) throw new WorkspaceError('presentation_too_large', 413);
  const state = await workspaceConnection(env, userId);
  if (state !== 'ready') throw new WorkspaceError(state, 409);
  const spec = GOOGLE_WORKSPACE_WRITES['files.create'];
  const url = new URL(spec.path, spec.origin);
  url.search = new URLSearchParams({ uploadType: 'multipart', fields: 'id,mimeType' }).toString();
  const boundary = `studioos-${crypto.randomUUID()}`;
  try {
    const stored = await loadRefreshTokenExport(env, 'google_oauth_tokens', userId);
    if (!stored?.raw) throw new WorkspaceError('google_not_connected', 409);
    const token = await refreshGoogleAccessToken(env, stored.raw);
    if (stored.wasPlaintext) await reencryptRefreshTokenExport(env, 'google_oauth_tokens', userId, stored.raw);
    const res = await fetcher(url.toString(), {
      method: spec.method,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipartBody(file.name, file.bytes, boundary),
    });
    if (!res.ok) {
      throw new WorkspaceError(res.status === 429 ? 'google_rate_limited' : res.status === 401 || res.status === 403 ? 'workspace_not_allowed' : 'google_not_created', res.status === 401 || res.status === 403 ? 409 : 503);
    }
    const text = await boundedText(res);
    let answer: any = null;
    try { answer = JSON.parse(text); } catch { answer = null; }
    if (!validFileId(answer?.id)) throw new WorkspaceError('google_not_created');
    const converted = answer.mimeType === SLIDES_MIME;
    return { file_id: answer.id, converted, url: presentationUrl(answer.id, converted) };
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError('google_not_created');
  }
}

async function boundedText(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > ANSWER_MAX_BYTES) throw new WorkspaceError('google_not_created');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  return new TextDecoder().decode(bytes);
}
