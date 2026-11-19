/**
 * #7147 step 5 (D7147-p3): write the staging resource ids into
 * `wrangler.toml`'s `[env.preview]`. Pure: text in, text out. The CLI is
 * `scripts/staging-write-ids.mjs`.
 *
 * It replaces only the four committed placeholders inside the `[env.preview]`
 * block, so no other environment can change. Every id must be in Cloudflare's
 * format and the three KV ids must differ. The result must pass the static
 * isolation preflight with every id written: an id equal to production's, or
 * a half-finished write, is refused before anything is saved. Running it
 * again with the same ids changes nothing.
 *
 * `subdomain` (optional, open question 4) is the account's workers.dev
 * subdomain. With it, `https://studioos-preview.workers.dev`, a host that does
 * not exist, becomes `https://studioos-preview.<subdomain>.workers.dev` in the
 * block's vars.
 */
import { D1_ID_RE, KV_ID_RE, preflight, provisioningState } from './previewIsolation.mjs';

export const PREVIEW_PLACEHOLDERS = Object.freeze({
  d1: 'REPLACE_WITH_PREVIEW_D1_ID',
  tokens: 'REPLACE_WITH_PREVIEW_KV_TOKENS_ID',
  rateLimits: 'REPLACE_WITH_PREVIEW_KV_RATE_LIMITS_ID',
  oauth: 'REPLACE_WITH_PREVIEW_KV_OAUTH_ID',
});

const BINDING_OF = Object.freeze({ d1: 'DB', tokens: 'TOKENS', rateLimits: 'RATE_LIMITS', oauth: 'OAUTH_KV' });
export const BARE_PREVIEW_HOST = 'https://studioos-preview.workers.dev';
const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** The `[env.preview]` block: from its header to the first table outside it. */
export function previewBlock(src) {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => l.trim() === '[env.preview]');
  if (start < 0) throw new Error('wrangler.toml has no [env.preview] table');
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const m = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(lines[i]);
    if (m && m[1] !== 'env.preview' && !m[1].startsWith('env.preview.')) { end = i; break; }
  }
  return { lines, start, end };
}

/** Replace the placeholders; throws with a reason instead of writing anything doubtful. */
export function writePreviewIds(src, { d1, tokens, rateLimits, oauth, subdomain = null } = {}) {
  const ids = { d1, tokens, rateLimits, oauth };
  for (const [k, v] of Object.entries(ids)) {
    if (typeof v !== 'string' || !v) throw new Error(`missing the ${BINDING_OF[k]} id`);
    ids[k] = v.trim().toLowerCase();
    const re = k === 'd1' ? D1_ID_RE : KV_ID_RE;
    if (!re.test(ids[k])) throw new Error(`${BINDING_OF[k]}: "${v}" is not a Cloudflare ${k === 'd1' ? 'D1 database id (a UUID)' : 'KV namespace id (32 hex characters)'}`);
  }
  if (new Set([ids.tokens, ids.rateLimits, ids.oauth]).size !== 3) throw new Error('the three KV namespaces must be three different ids');
  if (subdomain != null && !SUBDOMAIN_RE.test(subdomain)) throw new Error(`"${subdomain}" is not a workers.dev subdomain`);

  const before = provisioningState(src, 'preview');
  const { lines, start, end } = previewBlock(src);
  const block = lines.slice(start, end).join('\n');
  let out = block;
  for (const [k, placeholder] of Object.entries(PREVIEW_PLACEHOLDERS)) {
    const quoted = `"${placeholder}"`;
    const n = out.split(quoted).length - 1;
    if (n === 1) { out = out.replace(quoted, `"${ids[k]}"`); continue; }
    if (n > 1) throw new Error(`${placeholder} appears ${n} times in [env.preview]`);
    // Already written: only the same id again is a no-op.
    const current = before.ids.find((i) => i.binding === BINDING_OF[k])?.value;
    if (current !== ids[k]) throw new Error(`${BINDING_OF[k]} already holds ${current ?? 'no id'}; a different id needs a tear-down first (STAGING.md)`);
  }
  if (subdomain) out = out.split(`${BARE_PREVIEW_HOST}`).join(`https://studioos-preview.${subdomain}.workers.dev`);

  const next = [...lines.slice(0, start), ...out.split('\n'), ...lines.slice(end)].join('\n');
  const after = preflight(next, { env: 'preview', static: true });
  if (after.provisioning !== 'provisioned') throw new Error(`after the write [env.preview] is ${after.provisioning}, not provisioned`);
  if (after.unsafe.length) {
    const why = after.unsafe.map((u) => `${u.kind} ${u.binding}${u.field ? `.${u.field}` : ''}: ${u.status}`).join('; ');
    throw new Error(`the written config fails the isolation preflight (${why})`);
  }
  return { src: next, changed: next !== src };
}
