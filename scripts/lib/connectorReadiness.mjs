/**
 * D751 T9 (#1921) — which catalogue OAuth connectors have no client.
 *
 * `GET /api/health` carries `connectors_oauth: { <key>: true | false | null }`
 * (`cloudflare-worker/src/index.ts`): true when Axal holds the connector's
 * client, false when it does not, null when the read failed. The live smoke
 * lists each false or null key in one WARN line and in the run summary. It
 * fails only when the block is missing or malformed, or in strict mode
 * (`SMOKE_CONNECTORS_STRICT=1`) when anything is unset or unreadable.
 *
 * Nothing here prints a value: a malformed entry is named by its key, and a
 * key that is not a plain provider key is not echoed either.
 *
 * Pure: the verdict takes the parsed body, so a test hands it fixtures.
 */

export const CONNECTOR_READINESS_PATH = '/api/health';

const KEY_RE = /^[a-z0-9_]{1,40}$/;

/**
 * The verdict for one host's `/api/health` body.
 *   { ok, unset: string[], unreadable: string[], reason }
 * `reason` is set only when `ok` is false.
 */
export function connectorReadinessVerdict(body, { strict = false } = {}) {
  const block = body && typeof body === 'object' ? body.connectors_oauth : undefined;
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    return { ok: false, unset: [], unreadable: [], reason: 'the `connectors_oauth` block is missing from /api/health' };
  }
  const problems = [];
  const unset = [];
  const unreadable = [];
  for (const [key, value] of Object.entries(block)) {
    if (!KEY_RE.test(key)) { problems.push('a key is not a provider key'); continue; }
    if (value === false) unset.push(key);
    else if (value === null) unreadable.push(key);
    else if (value !== true) problems.push(`\`connectors_oauth.${key}\` is not true, false or null`);
  }
  if (problems.length > 0) {
    return { ok: false, unset, unreadable, reason: [...new Set(problems)].join('; ') };
  }
  if (strict && unset.length + unreadable.length > 0) {
    return { ok: false, unset, unreadable, reason: `strict mode: ${listing({ unset, unreadable })}` };
  }
  return { ok: true, unset, unreadable, reason: null };
}

/** "no client: github, slack; unreadable: zoom", or '' when every client is set. */
export function listing({ unset, unreadable }) {
  const parts = [];
  if (unset.length > 0) parts.push(`no client: ${unset.join(', ')}`);
  if (unreadable.length > 0) parts.push(`unreadable: ${unreadable.join(', ')}`);
  return parts.join('; ');
}

/** The one WARN line for a host, or null when nothing is unset or unreadable. */
export function warnLine(url, verdict) {
  const what = listing(verdict);
  return what ? `[spa-live] WARN  ${url} — OAuth connectors ${what}` : null;
}

/** The `$GITHUB_STEP_SUMMARY` lines for a host: the same list, as Markdown. */
export function summaryMarkdown(url, verdict) {
  if (!verdict.ok && verdict.unset.length + verdict.unreadable.length === 0) {
    return `### OAuth connectors — ${url}\n\nFAIL: ${verdict.reason}\n`;
  }
  const what = listing(verdict);
  if (!what) return `### OAuth connectors — ${url}\n\nEvery catalogue OAuth connector has a client.\n`;
  const rows = [
    ...verdict.unset.map((k) => `- \`${k}\`: no client. The fix is the owner's keys.`),
    ...verdict.unreadable.map((k) => `- \`${k}\`: the readiness read failed.`),
  ];
  return `### OAuth connectors — ${url}\n\n${rows.join('\n')}\n`;
}
