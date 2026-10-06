/**
 * D574 part 4 — a file in the Wellbeing resource library.
 *
 * A resource was a link. An admin can now attach a file instead (or as well):
 * a PDF, an audio recording or a video, stored in the private `FILES` bucket
 * under `wellbeing/resources/<resource uid>/`. Members read it through
 * `GET /api/wellbeing/resources/:uid/file`, which applies the same rule as the
 * list (a draft is the admins' alone) and answers HTTP Range, so audio and
 * video seek. No bucket URL is ever handed out.
 *
 * ONE REQUEST, NOT A MULTIPART UPLOAD. A Worker request body is capped at
 * 100 MB, and a library file is a handout or a recording, not a course video
 * (Learning's D561 route takes those in parts). So a file is one PUT of at
 * most 95 MB, and a larger one is refused with that limit named.
 */

export const RESOURCE_FILE_PREFIX = 'wellbeing/resources/';
export const RESOURCE_FILE_MAX_BYTES = 95 * 1024 * 1024;

/** The types a file may be, and the extension its key carries. */
export const RESOURCE_FILE_TYPES: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/** The bare media type of a Content-Type header, lower-cased, without parameters. */
export function mediaType(header: string | null | undefined): string {
  return String(header ?? '').split(';')[0].trim().toLowerCase();
}

/** A fresh key under the resource's own prefix: a re-upload never overwrites what a member is reading. */
export function newResourceFileKey(resourceUid: string, type: string): string {
  const ext = RESOURCE_FILE_TYPES[type] ?? 'bin';
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${RESOURCE_FILE_PREFIX}${resourceUid}/${rand}.${ext}`;
}

/** The member-facing path of a resource's file. */
export const resourceFilePath = (resourceUid: string) => `/api/wellbeing/resources/${encodeURIComponent(resourceUid)}/file`;
