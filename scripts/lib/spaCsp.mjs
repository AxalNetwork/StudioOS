/**
 * The SPA shell's Content-Security-Policy (D9166, #9166): which inline code in
 * a built shell needs a hash, the policy built from those hashes, and the one
 * `_headers` line that carries it. Pure: the Vite plugin in
 * `frontend/vite.config.js` writes the line into `docs/_headers`,
 * `frontend/test/spa_csp_9166.test.mjs` proves every shell is covered, and
 * `../check-spa-live.mjs` checks the live header against the live shell.
 *
 * The shell's inline `<script>` blocks (theme init, the dev flag, the dev
 * service-worker killer, the boot watchdog) and its one inline event handler
 * (the font stylesheet's `onload`) are allowed by sha256 hash. Nothing else
 * inline is: no `'unsafe-inline'` and no `'unsafe-eval'` in `script-src`. A
 * data block (`application/ld+json`) is not script and needs no hash.
 *
 * The origins are the ones the SPA loads from, read from `frontend/src`
 * (D9166 lists each one and the file that needs it). They are a superset of
 * what the Worker's nonce CSP allows for the same third parties
 * (`cloudflare-worker/src/middleware/securityHeaders.ts`: Stripe's script,
 * frames and API), because the shell runs the whole app and the Worker's
 * HTML pages run almost none of it.
 */
import { createHash } from 'node:crypto';

/** Shipped as Report-Only first (D9166); the enforcing name is the follow-up. */
export const SPA_CSP_HEADER = 'Content-Security-Policy-Report-Only';

/** `type` values a browser runs as script, so CSP's `script-src` governs them. */
const EXECUTABLE_TYPES = new Set([
  '', 'module', 'importmap',
  'text/javascript', 'application/javascript', 'application/ecmascript', 'text/ecmascript',
  'application/x-javascript', 'text/x-javascript', 'text/jscript', 'text/livescript',
  'text/javascript1.0', 'text/javascript1.1', 'text/javascript1.2', 'text/javascript1.3',
  'text/javascript1.4', 'text/javascript1.5',
]);

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;

function attr(attrs, name) {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? '';
}

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** The text of every inline `<script>` a browser executes: no `src`, and a JavaScript type (or none). */
export function executableInlineScripts(html) {
  const out = [];
  for (const m of String(html).replace(COMMENT_RE, '').matchAll(SCRIPT_RE)) {
    const attrs = m[1];
    if (attr(attrs, 'src') !== null) continue;
    const type = (attr(attrs, 'type') ?? '').trim().toLowerCase().split(';')[0].trim();
    if (!EXECUTABLE_TYPES.has(type)) continue;
    out.push(m[2]);
  }
  return out;
}

/** The value of every inline event-handler attribute (`onload="…"`) outside a script, decoded as the browser hashes it. */
export function inlineEventHandlers(html) {
  const out = [];
  const markup = String(html).replace(COMMENT_RE, '').replace(SCRIPT_RE, '<script></script>');
  for (const tag of markup.matchAll(/<[a-z][^\s/>]*((?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/gi)) {
    for (const a of tag[1].matchAll(/\s(on[a-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      out.push(decodeEntities(a[2] ?? a[3] ?? a[4] ?? ''));
    }
  }
  return out;
}

/** A CSP hash source for `text`: `'sha256-<base64>'`. */
export function cspHash(text) {
  return `'sha256-${createHash('sha256').update(String(text), 'utf8').digest('base64')}'`;
}

/** The hash sources a shell needs, in document order, each once. */
export function shellHashes(html) {
  const uniq = (xs) => [...new Set(xs)];
  return {
    scripts: uniq(executableInlineScripts(html).map(cspHash)),
    handlers: uniq(inlineEventHandlers(html).map(cspHash)),
  };
}

/**
 * Every directive but the hashes. Each origin is here because a file under
 * `frontend/src` (or `frontend/index.html`) loads from it; D9166 names them.
 */
export const SPA_CSP_DIRECTIVES = Object.freeze({
  'default-src': ["'self'"],
  'script-src': [
    "'self'",
    'https://js.stripe.com',
    'https://challenges.cloudflare.com',
    'https://accounts.google.com',
    'https://apis.google.com',
    'https://www.google.com',
    'https://www.gstatic.com',
    'https://connect.facebook.net',
  ],
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com'],
  'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
  'img-src': ["'self'", 'data:', 'blob:', 'https:'],
  'media-src': ["'self'", 'blob:', 'https:'],
  'connect-src': [
    "'self'",
    'https://axal.vc', 'https://app.axal.vc', 'https://www.axal.vc',
    'wss://axal.vc', 'wss://app.axal.vc',
    'https://api.stripe.com',
    'https://*.cloudflareaccess.com',
    'https://accounts.google.com',
    'https://www.facebook.com',
  ],
  'frame-src': [
    "'self'", 'blob:',
    'https://js.stripe.com', 'https://hooks.stripe.com', 'https://*.stripe.network',
    'https://challenges.cloudflare.com',
    'https://accounts.google.com', 'https://docs.google.com', 'https://www.google.com',
    'https://www.facebook.com',
    'https://calendly.com',
    'https://www.youtube-nocookie.com', 'https://player.vimeo.com',
    'https://iframe.videodelivery.net', 'https://*.cloudflarestream.com',
  ],
  'worker-src': ["'self'", 'blob:'],
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
});

/** The policy for a shell with these hashes. Handler hashes need `'unsafe-hashes'` (CSP3), which admits only them. */
export function spaCspPolicy({ scripts = [], handlers = [] } = {}) {
  return Object.entries(SPA_CSP_DIRECTIVES).map(([name, values]) => {
    let v = values;
    if (name === 'script-src') v = [values[0], ...scripts, ...(handlers.length ? ["'unsafe-hashes'", ...handlers] : []), ...values.slice(1)];
    return `${name} ${v.join(' ')}`;
  }).join('; ');
}

/** The policy a built shell needs. */
export function policyForShell(html) {
  return spaCspPolicy(shellHashes(html));
}

/** `_headers` holds the policy on one indented line under its `/*` rule. */
export function cspLine(policy) {
  return `  ${SPA_CSP_HEADER}: ${policy}`;
}

const LINE_RE = new RegExp(`^[ \\t]+${SPA_CSP_HEADER}:[^\\n]*$`, 'gmi');

/** The policy a `_headers` text carries, or null. More than one line is an error: rules would join them. */
export function policyInHeaders(text) {
  const lines = String(text).match(LINE_RE) || [];
  if (lines.length > 1) throw new Error(`_headers sets ${SPA_CSP_HEADER} ${lines.length} times; it must be once`);
  return lines.length ? lines[0].replace(/^[ \t]+[^:]+:\s*/, '').trim() : null;
}

/** `text` with its policy line replaced by `policy`. Throws when there is no line to replace. */
export function withPolicy(text, policy) {
  if (policyInHeaders(text) === null) throw new Error(`_headers has no ${SPA_CSP_HEADER} line to fill (D9166)`);
  return String(text).replace(LINE_RE, () => cspLine(policy));
}

/** The `'sha256-…'` sources in a policy's `script-src`. */
export function hashesInPolicy(policy) {
  const scriptSrc = String(policy).split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0].toLowerCase() === 'script-src') || [];
  return scriptSrc.filter((v) => /^'sha256-[A-Za-z0-9+/]+=*'$/.test(v));
}

/** Hashes a shell needs that the policy lacks, as readable problems (empty when covered). */
export function uncoveredInline(html, policy) {
  const have = new Set(hashesInPolicy(policy));
  const { scripts, handlers } = shellHashes(html);
  const problems = [];
  for (const h of scripts) if (!have.has(h)) problems.push(`inline <script> ${h} has no hash in ${SPA_CSP_HEADER}`);
  for (const h of handlers) if (!have.has(h)) problems.push(`inline event handler ${h} has no hash in ${SPA_CSP_HEADER}`);
  if (handlers.length && !/(?:^|;)\s*script-src\b[^;]*'unsafe-hashes'/i.test(policy)) problems.push(`${SPA_CSP_HEADER} lacks 'unsafe-hashes' for the inline event handlers`);
  return problems;
}

/**
 * The live check (`../check-spa-live.mjs`, every shell route on both hosts): the response carries the shell
 * policy, its `script-src` keeps `'self'` and no `'unsafe-inline'`, and every inline script and handler in the
 * body that came with it has its hash there. Problems name a "security header" so the run prints its hint.
 */
export function shellCspProblems(headers, body) {
  const name = SPA_CSP_HEADER.toLowerCase();
  const policy = headers.get(name);
  if (policy == null) return [`missing security header ${name} (docs/_headers not applied, D9166)`];
  const scriptSrc = policy.split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0].toLowerCase() === 'script-src') || [];
  const problems = [];
  if (!scriptSrc.includes("'self'")) problems.push(`security header ${name} has no 'self' in script-src`);
  if (scriptSrc.includes("'unsafe-inline'")) problems.push(`security header ${name} allows 'unsafe-inline' scripts`);
  for (const p of uncoveredInline(body, policy)) problems.push(`security header ${name}: ${p}`);
  return problems;
}
