/**
 * D1319 (#3480, part 1 of #2400) — the check every founder publish passes
 * before it can be confirmed, on each destination's final text and alt text.
 *
 *   1. `lintForSend(…, 'public')` (telegramRedactCheck.ts): emails, phones,
 *      tax ids, IBANs, card-like numbers, and any Axal member named, by email
 *      or by full legal name. A named member passes only when the founder
 *      ticked "They agreed to be named" for them (`namedConsent`).
 *   2. A SECRET SCAN: key prefixes, private-key blocks, JWT shapes, URLs with
 *      credentials, and long high-entropy tokens.
 *   3. A TEAM-ONLY CHECK: a team-only figure the draft quotes, unless the
 *      founder ticked team-only figures in for this draft.
 *
 * EVERY FINDING BLOCKS (#2400 decision E, (a)). There is no override. A
 * finding carries its kind, offset and length so the sheet can highlight it;
 * a secret's match is masked, and logs keep the kinds only, never the text.
 */
import type { Env } from '../types';
import { lintForSend, type RedactFinding } from './telegramRedactCheck';

export interface PublishLintResult {
  ok: boolean;
  findings: RedactFinding[];
  /** The kinds found, sorted and distinct: what a log or a send row may keep. */
  kinds: string[];
}

/** Secret shapes, each a kind of its own so the sheet can say which. */
const SECRET_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['api_key', /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{10,}\b/g],
  ['api_key', /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{30,}\b/g],
  ['api_key', /\bgithub_pat_[0-9A-Za-z_]{40,}\b/g],
  ['api_key', /\bglpat-[0-9A-Za-z_-]{20,}\b/g],
  ['api_key', /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/g],
  ['api_key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['api_key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['jwt', /\beyJ[0-9A-Za-z_-]{8,}\.eyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\b/g],
  ['url_credentials', /\bhttps?:\/\/[^\s/:@]+:[^\s/@]+@[^\s/]+/gi],
];
/** A long run with no spaces that could be a token: checked for entropy below. */
const TOKEN_RE = /[A-Za-z0-9_\-+/=]{32,}/g;

function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) { const p = n / s.length; h -= p * Math.log2(p); }
  return h;
}
/** A token, not a word or a link path: mixed letters and digits, high entropy. */
function looksLikeToken(s: string): boolean {
  return /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s) && entropy(s) >= 4;
}
const mask = (s: string) => (s.length <= 6 ? '*'.repeat(s.length) : `${s.slice(0, 4)}${'*'.repeat(Math.min(12, s.length - 4))}`);

/** The secret findings in `text`; overlapping hits are reported once. */
export function scanSecrets(text: string): RedactFinding[] {
  const out: RedactFinding[] = [];
  const taken: Array<[number, number]> = [];
  const free = (a: number, b: number) => !taken.some(([x, y]) => a < y && b > x);
  for (const [kind, re] of SECRET_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      if (!free(at, at + m[0].length)) continue;
      taken.push([at, at + m[0].length]);
      out.push({ kind: 'secret', severity: 'high', match: mask(m[0]), context: `Looks like ${kind === 'private_key' ? 'a private key' : kind === 'jwt' ? 'a sign-in token' : kind === 'url_credentials' ? 'a link with a password in it' : 'an API key'}.`, offset: at, length: m[0].length });
    }
  }
  for (const m of text.matchAll(TOKEN_RE)) {
    const at = m.index ?? 0;
    if (!free(at, at + m[0].length) || !looksLikeToken(m[0])) continue;
    taken.push([at, at + m[0].length]);
    out.push({ kind: 'secret', severity: 'high', match: mask(m[0]), context: 'Looks like a key or token.', offset: at, length: m[0].length });
  }
  return out;
}

/** The team-only figures the draft quotes that appear in `text`, unless ticked in. */
export function scanTeamOnly(text: string, teamOnly: readonly string[], included: boolean): RedactFinding[] {
  if (included) return [];
  const out: RedactFinding[] = [];
  for (const figure of teamOnly) {
    const f = String(figure ?? '').trim();
    if (f.length < 2) continue;
    const at = text.indexOf(f);
    if (at >= 0) out.push({ kind: 'team_only', severity: 'high', match: f, context: 'A team-only figure: tick team-only figures in for this draft, or remove it.', offset: at, length: f.length });
  }
  return out;
}

export async function publishLint(
  env: Env,
  text: string,
  opts: { teamOnly?: readonly string[]; teamOnlyIncluded?: boolean; namedConsent?: readonly number[] } = {},
): Promise<PublishLintResult> {
  const body = String(text ?? '');
  const consent = new Set((opts.namedConsent ?? []).map(Number));
  const base = await lintForSend(env, body, 'public');
  // A named member blocks unless the founder recorded that they agreed to be named.
  const findings = base.findings.filter((f) => !(f.kind === 'private_in_public' && f.user_id != null && consent.has(Number(f.user_id))));
  findings.push(...scanSecrets(body), ...scanTeamOnly(body, opts.teamOnly ?? [], !!opts.teamOnlyIncluded));
  findings.sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));
  return { ok: findings.length === 0, findings, kinds: [...new Set(findings.map((f) => f.kind))].sort() };
}
