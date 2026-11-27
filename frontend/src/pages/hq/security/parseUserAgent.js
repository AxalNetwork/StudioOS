/**
 * D4801 (#4801, canvas SE04, SED "UA parsed client-side") — the browser and
 * operating system a session's stored user agent names, in words.
 *
 * `user_sessions` keeps the raw `user_agent` string and nothing else about the
 * device: no device name, no model, no location. So this reads only what the
 * string itself says, and it says less than it seems to:
 *
 *   - Windows 10 and 11 both send "Windows NT 10.0", so they read as one.
 *   - Every Mac sends "Mac OS X 10_15_7" whatever it runs (the version has
 *     been frozen since 2020), so macOS is drawn without a version.
 *   - An iPad on iPadOS 13 or later sends the Mac string. It reads as macOS,
 *     which is what the string claims.
 *
 * Order matters: Edge, Opera and Samsung Internet carry "Chrome/" too, and
 * Chrome carries "Safari/", so the more specific token is matched first.
 * Anything unrecognised comes back `null` — the caller draws "Not recognised"
 * and keeps the raw string under View details, never a guess.
 */

const BROWSERS = [
  { name: 'Edge', re: /\bEdg(?:e|A|iOS)?\/(\d+)/ },
  { name: 'Opera', re: /\b(?:OPR|Opera)\/(\d+)/ },
  { name: 'Samsung Internet', re: /\bSamsungBrowser\/(\d+)/ },
  { name: 'Firefox', re: /\b(?:Firefox|FxiOS)\/(\d+)/ },
  { name: 'Chrome', re: /\b(?:Chrome|CriOS)\/(\d+)/ },
  // Safari last: its version is the `Version/` token, and only a string that
  // names no other engine above is Safari.
  { name: 'Safari', re: /\bVersion\/(\d+)(?:\.\d+)*.*\bSafari\// },
];

const under = (s) => String(s || '').replace(/_/g, '.');

function osOf(ua) {
  let m;
  if ((m = /\bWindows NT (\d+\.\d+)/.exec(ua))) {
    const v = { '10.0': '10 or 11', '6.3': '8.1', '6.2': '8', '6.1': '7' }[m[1]];
    return v ? `Windows ${v}` : 'Windows';
  }
  if ((m = /\biPhone OS (\d+(?:_\d+)?)/.exec(ua))) return `iOS ${under(m[1])}`;
  if ((m = /\biPad;.*\bOS (\d+(?:_\d+)?)/.exec(ua))) return `iPadOS ${under(m[1])}`;
  if ((m = /\bAndroid (\d+(?:\.\d+)?)/.exec(ua))) return `Android ${m[1]}`;
  if (/\bCrOS\b/.test(ua)) return 'ChromeOS';
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return 'macOS';
  if (/\bLinux\b/.test(ua)) return 'Linux';
  return null;
}

/**
 * `{ browser, os, label }` for a stored user agent. `browser` is "Name 132"
 * (major version only) or null; `os` is a name or null; `label` is the two
 * joined with " · ", or null when neither was recognised. A missing user
 * agent comes back `{ browser: null, os: null, label: null, missing: true }`
 * so the row can say none was stored rather than "not recognised".
 */
export function parseUserAgent(raw) {
  const ua = String(raw ?? '').trim();
  if (!ua) return { browser: null, os: null, label: null, missing: true };
  let browser = null;
  for (const b of BROWSERS) {
    const m = b.re.exec(ua);
    if (m) { browser = `${b.name} ${m[1]}`; break; }
  }
  const os = osOf(ua);
  const label = [browser, os].filter(Boolean).join(' · ') || null;
  return { browser, os, label, missing: false };
}
