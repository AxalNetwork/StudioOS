#!/usr/bin/env node
/**
 * #3662 — the Pitch acceptance run, live. It signs in as a SYNTHETIC test
 * founder the owner set up, opens the Pitch deck studio's pages in a real
 * browser at desktop and phone widths, screenshots each, and (only when
 * asked) downloads the PDF, PowerPoint and HTML exports of the test deck and
 * checks each is the file it claims to be. It writes `results.json` and
 * `matrix.md` (pass / fail / not tested, with the build's revision) into the
 * output folder, for documentation/operations/PITCH_ACCEPTANCE.md.
 *
 * WHAT IT NEVER DOES. It creates no share link, sends no message, signs no
 * NDA, accepts no terms and invites nobody. It touches only the test
 * account's own test deck. It never runs against an account the owner has
 * not confirmed is a test account (PITCH_TEST_ACCOUNT=synthetic), and it
 * reads no production data beyond what that account owns.
 *
 * WHAT IT CANNOT PROVE. Whether a slide LOOKS right: the screenshots are for
 * a person to compare with the Pitch Deck Studio boards (PD1–PD28). Google
 * Slides, the share lifecycle, read-only roles and revoked connections stay
 * "not tested" here and in the matrix until someone runs them by hand.
 *
 * It cannot run from an agent sandbox (the proxy answers 403 CONNECT for
 * axal.vc); run it from a machine or a workflow that can reach the host.
 *
 *   PITCH_BASE_URL=https://axal.vc PITCH_SESSION='<cookie header>' PITCH_PROJECT_ID=<id> \
 *   PITCH_DECK_ID=<id> PITCH_TEST_ACCOUNT=synthetic [PITCH_EXPORTS=1] [PITCH_REVISION=<sha>] \
 *   [PITCH_OUT=pitch-acceptance-out] node scripts/pitch-acceptance-live.mjs
 *
 * Exit 0: every step it ran passed. Exit 1: a step failed. Exit 2: it is not
 * configured, or not allowed to run, and verified nothing — never 0.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PAGES = Object.freeze([
  { key: 'decks', path: '/raise/pitch', label: 'Decks (PD2)' },
  { key: 'editor', path: '/raise/pitch/edit', label: 'Editor (PD1)' },
  { key: 'review', path: '/raise/pitch/review', label: 'Review (PD14)' },
  { key: 'present', path: '/raise/pitch/present', label: 'Present (PD16)' },
  { key: 'analytics', path: '/raise/pitch/analytics', label: 'Share & analytics (PD19)' },
]);
export const VIEWPORTS = Object.freeze([
  { key: 'desktop', width: 1440, height: 900 },
  { key: 'phone', width: 390, height: 844 },
]);
/** Words that mean the page broke rather than drew. */
export const BROKEN = Object.freeze([/Something went wrong/i, /Unexpected Application Error/i, /Cannot read properties of/i]);
/** Rows the live run never covers; the matrix says "not tested" for each, never a pass. */
export const MANUAL_ROWS = Object.freeze([
  'Non-owner founder, HQ versus Founder preview, read-only roles, revoked connections',
  'Create, outline, generate, keep, save and reload; text, layout, notes, image, chart and diagram editing',
  'Sources and evidence check; review; versions, compare and restore',
  'Present keyboard and phone behaviour',
  'Google Slides export (authorized connection)',
  'Share lifecycle: frozen version, expiry, NDA, download and forwarding limits, revocation, analytics (synthetic recipients only)',
  'AI off, failed inference, sparse, stale or conflicting data, interrupted jobs, stale tabs, simultaneous proposals',
]);

/** Why the run may not start, or null. Every reason exits 2: nothing verified. */
export function configProblem(env) {
  if (!env.PITCH_BASE_URL) return 'PITCH_BASE_URL is not set.';
  let u;
  try { u = new URL(env.PITCH_BASE_URL); } catch { return 'PITCH_BASE_URL is not a URL.'; }
  if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return 'PITCH_BASE_URL must be https (or localhost).';
  if (env.PITCH_TEST_ACCOUNT !== 'synthetic') return 'PITCH_TEST_ACCOUNT=synthetic is required: the owner confirms the account is a test account.';
  if (!env.PITCH_SESSION) return 'PITCH_SESSION (the test account’s session cookie header) is not set.';
  if (!/^\d+$/.test(String(env.PITCH_PROJECT_ID || ''))) return 'PITCH_PROJECT_ID (the test venture) is not set.';
  if (env.PITCH_EXPORTS === '1' && !/^\d+$/.test(String(env.PITCH_DECK_ID || ''))) return 'PITCH_DECK_ID (the test deck) is required for the exports.';
  return null;
}

/** A page's verdict from what it drew: broken words fail; an empty body fails. */
export function pageVerdict(text) {
  const t = String(text || '');
  const hit = BROKEN.find((re) => re.test(t));
  if (hit) return { ok: false, why: `The page shows "${hit.source}".` };
  if (t.replace(/\s+/g, '').length < 40) return { ok: false, why: 'The page drew almost nothing.' };
  return { ok: true, why: null };
}

/** Whether downloaded bytes are the file they claim: magic numbers and, for PowerPoint, its parts. */
export function fileVerdict(format, bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length < 64) return { ok: false, why: `The ${format} file is ${b.length} bytes.` };
  const head = String.fromCharCode(...b.subarray(0, 8));
  if (format === 'pdf') return head.startsWith('%PDF-') ? { ok: true, why: null } : { ok: false, why: 'The PDF does not start with %PDF-.' };
  if (format === 'pptx') {
    if (!(b[0] === 0x50 && b[1] === 0x4b)) return { ok: false, why: 'The PowerPoint is not a zip.' };
    const text = new TextDecoder('latin1').decode(b);
    return text.includes('ppt/presentation.xml') ? { ok: true, why: null } : { ok: false, why: 'The PowerPoint has no ppt/presentation.xml.' };
  }
  if (format === 'html') {
    const text = new TextDecoder().decode(b.subarray(0, 512)).toLowerCase();
    return text.startsWith('<!doctype html>') && text.includes('content-security-policy') ? { ok: true, why: null } : { ok: false, why: 'The HTML file is not the offline deck.' };
  }
  return { ok: false, why: `Unknown format ${format}.` };
}

/** The matrix, in Markdown: what ran, what passed, and every row it did not cover as "Not tested". */
export function matrixMarkdown(results, { revision = 'not recorded', base = '', when = new Date().toISOString() } = {}) {
  const word = (r) => (r.ok ? 'Pass' : 'Fail');
  const lines = [
    `# Pitch acceptance, live run`, '', `- **Revision:** ${revision}`, `- **Host:** ${base}`, `- **When:** ${when}`, '',
    '| Area | Result | Evidence |', '|---|---|---|',
    ...results.map((r) => `| ${r.label} | ${word(r)} | ${r.evidence || ''}${r.why ? ` — ${r.why}` : ''} |`),
    ...MANUAL_ROWS.map((m) => `| ${m} | Not tested | Manual: see PITCH_ACCEPTANCE.md |`),
  ];
  return `${lines.join('\n')}\n`;
}

async function main(env = process.env) {
  const problem = configProblem(env);
  if (problem) { console.error(`[pitch-acceptance] ${problem} Nothing was verified.`); return 2; }
  const base = env.PITCH_BASE_URL.replace(/\/$/, '');
  const out = env.PITCH_OUT || 'pitch-acceptance-out';
  mkdirSync(out, { recursive: true });
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { console.error('[pitch-acceptance] Playwright is not installed. Nothing was verified.'); return 2; }
  const browser = await chromium.launch();
  const results = [];
  try {
    const host = new URL(base).hostname;
    const cookies = String(env.PITCH_SESSION).split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
      const i = p.indexOf('=');
      return { name: p.slice(0, i), value: p.slice(i + 1), domain: host, path: '/', secure: base.startsWith('https:'), httpOnly: true };
    });
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      await context.addCookies(cookies);
      const page = await context.newPage();
      for (const p of PAGES) {
        const url = `${base}${p.path}?project_id=${env.PITCH_PROJECT_ID}`;
        const shot = join(out, `${p.key}-${vp.key}.png`);
        try {
          const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
          const verdict = res && res.status() < 400 ? pageVerdict(await page.innerText('body')) : { ok: false, why: `HTTP ${res ? res.status() : 'no answer'}` };
          await page.screenshot({ path: shot, fullPage: true });
          results.push({ label: `${p.label}, ${vp.key}`, ok: verdict.ok, why: verdict.why, evidence: shot });
        } catch (e) {
          results.push({ label: `${p.label}, ${vp.key}`, ok: false, why: `The page did not load (${e?.name || 'error'}).`, evidence: '' });
        }
      }
      await context.close();
    }
    if (env.PITCH_EXPORTS === '1') {
      const headers = { cookie: env.PITCH_SESSION, 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' };
      const deck = env.PITCH_DECK_ID;
      for (const [format, path, body] of [['pdf', `/api/decks/${deck}/export`, { format: 'pdf' }], ['pptx', `/api/decks/${deck}/export`, { format: 'pptx' }], ['html', `/api/decks/${deck}/export/html`, {}]]) {
        const file = join(out, `export.${format}`);
        try {
          const res = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
          const bytes = new Uint8Array(await res.arrayBuffer());
          writeFileSync(file, bytes);
          const verdict = res.ok ? fileVerdict(format, bytes) : { ok: false, why: `HTTP ${res.status}` };
          results.push({ label: `Export ${format.toUpperCase()}`, ok: verdict.ok, why: verdict.why, evidence: file });
        } catch (e) {
          results.push({ label: `Export ${format.toUpperCase()}`, ok: false, why: `The export did not answer (${e?.name || 'error'}).`, evidence: '' });
        }
      }
    }
  } finally { await browser.close(); }
  const meta = { revision: env.PITCH_REVISION || 'not recorded', base, when: new Date().toISOString() };
  writeFileSync(join(out, 'results.json'), JSON.stringify({ ...meta, results }, null, 2));
  writeFileSync(join(out, 'matrix.md'), matrixMarkdown(results, meta));
  const failed = results.filter((r) => !r.ok);
  console.log(`[pitch-acceptance] ${results.length - failed.length} of ${results.length} passed; ${MANUAL_ROWS.length} rows not tested. See ${join(out, 'matrix.md')}.`);
  return failed.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) main().then((code) => process.exit(code));
