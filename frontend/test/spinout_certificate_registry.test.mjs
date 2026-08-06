/**
 * The graduation certificate page and the registry that was already behind it.
 *
 * THE BUG. `spinout_certificates` ships in the production worker
 * (routes/spinout_certificates.ts) with issue, revoke, list, mine and sharing
 * routes, and the public verifier is live and routed at /verify/:token. The
 * founder-facing page told every graduate the opposite:
 *
 *   "Not issued from a registry"
 *   "None exist yet, so none are shown"
 *   "A third party cannot verify it yet — that needs the public verification
 *    endpoint the design proposes"
 *
 * All three were false. The page was written against the FOUR TABLE NAMES THE
 * DESIGN PROPOSED — issued_certificates, certificate_badges,
 * certificate_events, certificate_delivery_logs — none of which is what the
 * registry was actually built as. It looked for those, found nothing, and
 * concluded the whole system was unbuilt. A graduate holding a real,
 * publicly-verifiable credential was being told it could not be verified.
 *
 * THE LOCKSTEP. `certificateRef` (this lib) and `credentialRefFor` (the
 * worker) must produce byte-identical ids for the same graduate. The frontend
 * shows the reference BEFORE issuance and the worker allocates the row, so any
 * divergence means a founder's credential id silently changes under them at
 * issuance — after they may already have put it on a profile. The worker's own
 * comment says the two are "kept in lockstep deliberately"; nothing enforced
 * it until this file.
 *
 * Both functions are evaluated from their real source text rather than
 * reimplemented, so this cannot pass against a stale copy.
 *
 * Run with:  node --test frontend/test/spinout_certificate_registry.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const PAGE = read('../src/pages/SpinoutLabCertificatePage.jsx');
const LIB = read('../src/lib/graduationCertificate.js');
const WORKER = read('../../cloudflare-worker/src/routes/spinout_certificates.ts');

const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** Pull a named function out of source text and make it callable. */
function extract(src, name, extraDeps = '') {
  const start = src.indexOf(`export function ${name}`);
  assert.notEqual(start, -1, `${name} not found`);
  const body = src.slice(start).replace(/^export /, '');
  const end = body.indexOf('\n}\n');
  assert.notEqual(end, -1, `could not bound ${name}`);
  // eslint-disable-next-line no-new-func
  return new Function(`${extraDeps}\n${body.slice(0, end + 3)}\nreturn ${name};`)();
}

/** Source text of a named function, ready to eval (its `export` removed). */
function source(src, name) {
  const start = src.indexOf(`export function ${name}`);
  assert.notEqual(start, -1, `${name} not found`);
  const body = src.slice(start).replace(/^export /, '');
  return body.slice(0, body.indexOf('\n}\n') + 3);
}

// certificateRef calls cohortNumber, so that dependency comes along.
const certificateRef = extract(LIB, 'certificateRef', source(LIB, 'cohortNumber'));

// The worker's TS signature is positional and typed; strip the annotations so
// the same body runs under plain JS.
const credentialRefFor = (() => {
  const start = WORKER.indexOf('export function credentialRefFor');
  const body = WORKER.slice(start).replace(/^export /, '');
  const js = body.slice(0, body.indexOf('\n}\n') + 3)
    .replace(/cohortLabel: string \| null, conferredAt: string, userId: number/, 'cohortLabel, conferredAt, userId');
  // eslint-disable-next-line no-new-func
  return new Function(`${js}\nreturn credentialRefFor;`)();
})();

// ---------------------------------------------------------------------------
// Lockstep — the reference shown before issuance is the one that gets issued.
// ---------------------------------------------------------------------------

test('both implementations agree on a normal graduate', () => {
  const args = { cohortLabel: 'Cohort 4', conferredAt: '2026-07-31', userId: 117 };
  assert.equal(certificateRef(args), 'AXL-SOL-C4-260731-0117');
  assert.equal(credentialRefFor(args.cohortLabel, args.conferredAt, args.userId), 'AXL-SOL-C4-260731-0117');
});

test('both implementations agree across the awkward inputs', () => {
  const cohorts = [null, '', 'Cohort 4', 'Cohort 12', 'August 2026 Cohort', 'Alumni', 'C7', '4'];
  const dates = ['2026-01-01', '2026-12-31', '2026-07-31T10:30:00Z', '2027-02-28'];
  const ids = [1, 9, 42, 117, 9999, 12345];
  for (const c of cohorts) {
    for (const d of dates) {
      for (const u of ids) {
        assert.equal(
          certificateRef({ cohortLabel: c, conferredAt: d, userId: u }),
          credentialRefFor(c, d, u),
          `divergence at cohort=${JSON.stringify(c)} date=${d} user=${u}`,
        );
      }
    }
  }
});

test('both implementations refuse the same unusable inputs', () => {
  const bad = [
    [null, '', 117],
    ['Cohort 4', '', 117],
    ['Cohort 4', '2026-07-31', 0],
    ['Cohort 4', '2026-07-31', -1],
    ['Cohort 4', '2026-07-31', NaN],
  ];
  for (const [c, d, u] of bad) {
    assert.equal(certificateRef({ cohortLabel: c, conferredAt: d, userId: u }), null);
    assert.equal(credentialRefFor(c, d, u), null);
  }
});

test('an unlabelled cohort degrades to X on both sides, not to a wrong number', () => {
  assert.equal(certificateRef({ cohortLabel: 'Alumni', conferredAt: '2026-07-31', userId: 5 }), 'AXL-SOL-X-260731-0005');
  assert.equal(credentialRefFor('Alumni', '2026-07-31', 5), 'AXL-SOL-X-260731-0005');
});

// ---------------------------------------------------------------------------
// The page now reads the registry.
// ---------------------------------------------------------------------------

test('the page fetches the caller’s own credential', () => {
  assert.match(PAGE, /api\.spinoutCertificateMine\(\)/);
  assert.match(PAGE, /setCredential\(cert\)/);
});

test('a missing credential is a normal state, not an error', () => {
  // A founder who has not been issued one must still get a working page.
  assert.match(PAGE, /spinoutCertificateMine\(\)\.then\(\(r\) => r\?\.certificate \?\? null\)\.catch\(\(\) => null\)/);
});

test('all three lifecycle states render', () => {
  assert.match(PAGE, /data-testid="card-credential-issued"/);
  assert.match(PAGE, /data-testid="card-credential-revoked"/);
  assert.match(PAGE, /data-testid="card-credential-pending"/);
});

test('the holder can turn public verification on and off', () => {
  assert.match(PAGE, /data-testid="toggle-public-sharing"/);
  assert.match(PAGE, /api\.spinoutCertificateSharing\(next\)/);
});

// ---------------------------------------------------------------------------
// The public link is built from the token, never from the credential id.
// ---------------------------------------------------------------------------

test('the verify URL keys on public_token', () => {
  assert.match(PAGE, /\/verify\/\$\{credential\.public_token\}/);
});

test('the verify URL is never built from credential_id', () => {
  // credential_id embeds the user id (…-0117), so a public URL keyed on it
  // would let anyone enumerate graduates by walking that number — which is
  // exactly why the worker generates a separate 128-bit token.
  assert.doesNotMatch(PAGE, /\/verify\/\$\{[^}]*credential_id/);
});

test('the worker keys public verification on the token too', () => {
  assert.match(WORKER, /publicCertificateRoutes\.get\('\/verify\/:token'/);
  assert.match(WORKER, /WHERE lower\(public_token\) = \?/);
});

// ---------------------------------------------------------------------------
// The false claims are gone.
// ---------------------------------------------------------------------------

test('the page no longer claims there is no registry', () => {
  const code = stripComments(PAGE);
  assert.doesNotMatch(code, /Not issued from a registry/);
  assert.doesNotMatch(code, /None exist yet, so none are shown/);
  assert.doesNotMatch(code, /not allocated by an issuance registry/);
});

test('the page no longer claims third parties cannot verify', () => {
  const code = stripComments(PAGE);
  assert.doesNotMatch(code, /A third party cannot verify it yet/);
  assert.doesNotMatch(code, /the public verification endpoint the design proposes/);
});

test('the page no longer names the four tables the design proposed', () => {
  const code = stripComments(PAGE);
  for (const t of ['issued_certificates', 'certificate_badges', 'certificate_events', 'certificate_delivery_logs']) {
    assert.doesNotMatch(code, new RegExp(t), `${t} is not what the registry was built as`);
  }
});

test('the lib no longer says there is nothing to allocate from', () => {
  assert.doesNotMatch(LIB, /with no registry there is nothing to allocate from/);
});

// ---------------------------------------------------------------------------
// The privacy boundary the worker documents is still the SELECT list.
// ---------------------------------------------------------------------------

test('the public payload never joins users or projects', () => {
  const pub = WORKER.slice(WORKER.indexOf('publicCertificateRoutes.get'));
  assert.doesNotMatch(pub, /JOIN/i, 'a join here could leak an email or an internal id');
  assert.doesNotMatch(pub, /public_token,\s*$/m, 'the token must not be echoed back');
});

test('sharing-off is reported as not-found, never as hidden', () => {
  // Otherwise the endpoint confirms the existence of a credential its holder
  // has deliberately closed.
  assert.match(WORKER, /if \(!row \|\| !row\.public_share_enabled\) return c\.json\(\{ detail: 'Not found' \}, 404\)/);
});
