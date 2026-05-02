/**
 * R2 helpers for KYC document storage.
 *
 * Design choices:
 *  - Bucket is private. We do NOT generate S3-style presigned URLs (that would
 *    require separate R2 access keys + a public URL surface). Instead, an
 *    auth-gated Worker route streams bytes from R2 on demand.
 *  - Keys: `kyc/{user_id}/{uuid}.{ext}` so we can list-by-prefix per user
 *    when handling deletions / GDPR requests.
 *  - We compute and store the SHA-256 of the bytes so admins can verify
 *    integrity and detect tampering.
 */
import type { Env } from '../types';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export interface KycDocumentMeta {
  file_key: string;
  content_type: string;
  size: number;
  sha256: string;
  uploaded_at: string;
}

function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Decode a `data:` URI, upload the raw bytes to R2, return file metadata.
 * Throws if R2 binding is missing — callers should fall back gracefully
 * (e.g. dev environments without an R2 bucket configured).
 */
export async function putKycDocumentFromDataUri(
  env: Env,
  userId: number,
  dataUri: string,
): Promise<KycDocumentMeta> {
  if (!env.FILES) throw new Error('R2 binding FILES not configured');
  const commaIdx = dataUri.indexOf(',');
  if (commaIdx < 0 || !dataUri.startsWith('data:')) throw new Error('Invalid data URI');
  const meta = dataUri.slice(5, commaIdx); // strip "data:"
  const contentType = meta.replace(';base64', '').trim();
  const ext = EXT_BY_MIME[contentType];
  if (!ext) throw new Error(`Unsupported content type: ${contentType}`);
  const bytes = bytesFromBase64(dataUri.slice(commaIdx + 1));
  const sha256 = await sha256Hex(bytes);
  const uuid = crypto.randomUUID();
  const fileKey = `kyc/${userId}/${uuid}.${ext}`;
  await env.FILES.put(fileKey, bytes, {
    httpMetadata: { contentType },
    customMetadata: { user_id: String(userId), sha256 },
  });
  return {
    file_key: fileKey,
    content_type: contentType,
    size: bytes.byteLength,
    sha256,
    uploaded_at: new Date().toISOString(),
  };
}

/** Fetch a KYC document from R2 for streaming back to an admin. */
export async function getKycDocument(env: Env, fileKey: string): Promise<R2ObjectBody | null> {
  if (!env.FILES) return null;
  if (!fileKey.startsWith('kyc/')) return null; // hard guard: never serve outside kyc/ prefix
  return await env.FILES.get(fileKey);
}

/** Delete a KYC document (e.g. on user deletion / GDPR request). */
export async function deleteKycDocument(env: Env, fileKey: string): Promise<void> {
  if (!env.FILES) return;
  if (!fileKey.startsWith('kyc/')) return;
  await env.FILES.delete(fileKey);
}

// ---------------------------------------------------------------------------
// Headshots — public-readable profile images stored under headshots/{user_id}/.
// We reuse the FILES R2 bucket with a separate key prefix so KYC and headshot
// objects never collide and the privacy guards in routes/settings.ts remain
// the single source of truth for who can view what.
// ---------------------------------------------------------------------------

const HEADSHOT_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface HeadshotMeta {
  file_key: string;
  content_type: string;
  size: number;
  uploaded_at: string;
}

export async function putHeadshotFromDataUri(
  env: Env,
  userId: number,
  dataUri: string,
): Promise<HeadshotMeta> {
  if (!env.FILES) throw new Error('R2 binding FILES not configured');
  const commaIdx = dataUri.indexOf(',');
  if (commaIdx < 0 || !dataUri.startsWith('data:')) throw new Error('Invalid data URI');
  const meta = dataUri.slice(5, commaIdx);
  const contentType = meta.replace(';base64', '').trim();
  const ext = HEADSHOT_MIME[contentType];
  if (!ext) throw new Error(`Unsupported image type: ${contentType} (allowed: jpeg, png, webp)`);
  const bytes = bytesFromBase64(dataUri.slice(commaIdx + 1));
  // 3MB hard ceiling at the byte level — `routes/settings.ts` already
  // ceilings the data-URI length but raw bytes are the truthful number.
  if (bytes.byteLength > 3 * 1024 * 1024) throw new Error('Image exceeds 3MB limit');
  const uuid = crypto.randomUUID();
  const fileKey = `headshots/${userId}/${uuid}.${ext}`;
  await env.FILES.put(fileKey, bytes, {
    httpMetadata: { contentType },
    customMetadata: { user_id: String(userId) },
  });
  return {
    file_key: fileKey,
    content_type: contentType,
    size: bytes.byteLength,
    uploaded_at: new Date().toISOString(),
  };
}

export async function getHeadshot(env: Env, fileKey: string): Promise<R2ObjectBody | null> {
  if (!env.FILES) return null;
  if (!fileKey.startsWith('headshots/')) return null;
  return await env.FILES.get(fileKey);
}
