/**
 * Sanitize a URL before binding it to an anchor `href`.
 *
 * Prevents `javascript:` / `data:` / `vbscript:` scheme injection (stored XSS)
 * when the URL originates from user- or AI-supplied data (company websites,
 * social links, evidence links, etc.). Returns `undefined` for anything that
 * isn't a plain http(s) link, a root-relative path, or a scheme-less domain —
 * so an unsafe value renders a non-navigable anchor instead of executing.
 */
export function safeExternalUrl(url) {
  if (typeof url !== 'string') return undefined;
  const t = url.trim();
  if (!t) return undefined;
  // Absolute http(s).
  if (/^https?:\/\//i.test(t)) return t;
  // Root-relative, but NOT protocol-relative ("//evil.com").
  if (/^\/(?!\/)/.test(t)) return t;
  // Scheme-less domain a user typed (e.g. "example.com", "www.x.com/path").
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(t)) return `https://${t}`;
  return undefined;
}
