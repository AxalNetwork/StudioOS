/**
 * D433 — Account: the compliance bridge, the company KYB pill and "Save
 * entity", sign-in factors as status rows, and the voice fix at the partner
 * notification label.
 *
 * EACH IS PINNED TO THE PROPERTY, NOT THE LITERAL.
 *
 * 1. THE BRIDGE HAS THREE STATES AND SAYS WHEN IT COULD NOT READ. Task #4's
 *    badge rendered nothing on a failed /trust/me, which drew what "no score"
 *    draws. The strip is mounted once at the top of the page, computes the
 *    score with Trust Center's own formula and verdict, and draws
 *    `<Unreadable>` with a retry on failure.
 *
 * 2. EACH COMPANY ROW CARRIES ITS KYB PILL AND CAN SAVE ITS ENTITY. The pill
 *    reads GET /trust/companies/kyb, matched by company id, with a third arm
 *    for a failed read; "Save entity" posts to the company route naming THAT
 *    row's company through the header override in api.js, which the worker
 *    still verifies against membership.
 *
 * 3. SIGN-IN & FACTORS ARE STATUS ROWS. The authenticator row reads the
 *    pairing date the worker now serves (`totp_paired_at`); the password row
 *    is an honest absence with its reason printed, because this platform has
 *    no password credential.
 *
 * 4. ROLES & ACCESS AND API KEYS ARE DRAWN UP TO THEIR LINE. One role per
 *    account is recorded; additional roles, delegates and API keys have no
 *    store and say so on screen, never as an empty list.
 *
 * 5. THE VOICE RULE. No notification label may call anything a
 *    recommendation, advice or an advisor's output.
 *
 * And /profile is a redirect to /account (D304 shape), with the exploring
 * sidebar row pointing where it lands.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = read('frontend/src/pages/SettingsPage.jsx');
const CODE = codeOnly(PAGE);
const API = codeOnly(read('frontend/src/lib/api.js'));
const APP = codeOnly(read('frontend/src/App.jsx'));
const SIDEBAR = codeOnly(read('frontend/src/sidebarConfig.js'));
const WORKER = codeOnly(read('cloudflare-worker/src/routes/settings.ts'));

function slice(src, from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + 1);
  assert.ok(a >= 0 && b > a, `could not slice ${from} → ${to}`);
  return src.slice(a, b);
}

// ---------------------------------------------------------------------------
// 1. The compliance bridge.
// ---------------------------------------------------------------------------

test('the bridge is one module-level component, mounted once at the top of every pane', () => {
  assert.equal((CODE.match(/^function ComplianceBridge\(\)/gm) || []).length, 1);
  assert.equal((CODE.match(/<ComplianceBridge \/>/g) || []).length, 1, 'mounted exactly once');
  // Above the pane grid, not inside one section: every pane gets it.
  const page = slice(CODE, 'export default function SettingsPage', 'function SectionDropdown');
  assert.ok(page.indexOf('<ComplianceBridge />') < page.indexOf('<div className="grid lg:grid-cols-[200px_1fr]'), 'the strip sits above the section grid');
  // The old badge, which rendered nothing on failure, is gone with its mount.
  assert.doesNotMatch(CODE, /function ProfileTrustBadge|<ProfileTrustBadge/);
});

test('the bridge has a failed state that says so with a retry, and an empty score is not drawn as nothing', () => {
  const b = slice(CODE, 'function ComplianceBridge()', 'const JURISDICTIONS');
  assert.match(b, /phase: 'failed'/);
  assert.match(b, /\.catch\(\(e\) => \{[^}]*phase: 'failed'/);
  assert.match(b, /data-testid="compliance-bridge-unreadable"/);
  assert.match(b, /<Unreadable what="Your trust score"[^>]*onRetry=\{\(\) => setAttempt\(\(n\) => n \+ 1\)\}/);
  assert.match(b, /\}, \[attempt\]\);/);
  assert.doesNotMatch(b, /\.catch\(\(\) => \{\}\)/, 'the silent catch is back');
});

test('the bridge draws Trust Center\'s own number and verdict, not a third formula', () => {
  const b = slice(CODE, 'function ComplianceBridge()', 'const JURISDICTIONS');
  assert.match(b, /const score = computeTrustScore\(obs\);/);
  assert.match(b, /\{verdictFor\(score\)\}/);
  assert.match(b, /scoreLine\(outstandingCounts\(required\)\)/);
  assert.match(PAGE, /import \{ verdictFor, outstandingCounts, scoreLine \} from '\.\.\/lib\/trustCenter';/);
  assert.doesNotMatch(b, /reqGates|weightOf|PREV_SCORE|scoreDelta/, 'the canvas\'s refused score model');
  assert.match(b, /<Link to="\/trust"/, 'the way out is the Trust Center');
  assert.match(b, /Trust Center reports on the data held here\./);
});

test('the completeness banner says when it could not read, instead of drawing what "complete" draws', () => {
  const b = slice(CODE, 'function ProfileCompletionBanner(', 'function ProfileTabs(');
  assert.match(b, /setFailed\(e\?\.message \|\| ''\)/);
  assert.match(b, /if \(failed !== null && !row\)/);
  assert.match(b, /<Unreadable what="Your profile completeness"/);
  assert.doesNotMatch(b, /catch\(\(\) => \{ \/\* silent \*\/ \}\)/);
});

// ---------------------------------------------------------------------------
// 2. The company rows.
// ---------------------------------------------------------------------------

test('each company row reads its KYB record from the company store and draws three pill arms', () => {
  const c = slice(CODE, 'function YourCompaniesSection(', 'function RolesAccessCard(');
  assert.match(c, /api\.companyKybList\(\)/);
  assert.match(c, /byCompany\[String\(it\.company_id\)\] = it\.kyb \|\| null;/, 'matched by company id, null for a company with no record');
  // Loading, failed and ready are different arms: a failed read is not "Not started".
  assert.match(c, /KYB · Unreadable/);
  assert.match(c, /KYB · \{kybStatusLabel\(record\?\.status\)\}/);
  assert.match(c, /data-testid="company-kyb-unreadable"/);
  assert.match(c, /<Unreadable what="Each company’s entity record"[^>]*onRetry=\{\(\) => setKybAttempt/);
  // The memberships read and the KYB read fail independently.
  assert.match(c, /const \[kyb, setKyb\] = useState\(\{ phase: 'loading'/);
});

test('"Save entity" writes THAT company through the company route, naming it by header override', () => {
  const e = slice(CODE, 'function CompanyEntityEditor(', 'function YourCompaniesSection(');
  assert.match(e, /api\.companyKybStart\(form, company\.id\)/);
  assert.match(e, /Save entity/);
  assert.match(e, /No registry match runs yet/, 'the canvas\'s "Registry match runs automatically on save" is not promised');
  const api = slice(API, 'companyKybStart:', 'getRequiredNdas:');
  assert.match(api, /companyKybStart: \(payload, companyId\) =>/);
  assert.match(api, /headers: \{ 'X-Company-Id': String\(companyId\) \}/);
  assert.match(api, /companyId === undefined \|\| companyId === null \? \{\} :/, 'no id → the active company, as before');
  // api.js merges options.headers LAST, so the override reaches the request.
  const req = slice(API, 'export async function request(', 'if (!res.ok)');
  assert.match(req, /\.\.\.companyHeader, \.\.\.options\.headers \}/);
});

test('the pill\'s labels come from the statuses the worker writes', () => {
  const c = slice(CODE, 'const KYB_STATUS_LABEL', 'function CompanyEntityEditor(');
  assert.match(c, /in_review: 'In review'/);
  assert.match(c, /if \(!status\) return 'Not started';/);
  const worker = codeOnly(read('cloudflare-worker/src/routes/trust.ts'));
  assert.match(worker, /VALUES \(\?, \?, \?, 'in_review'/, 'the write sets in_review');
});

// ---------------------------------------------------------------------------
// 3. Sign-in & factors.
// ---------------------------------------------------------------------------

test('the factor rows are drawn once, at the top of Security, from the payload the page already has', () => {
  assert.equal((CODE.match(/<SignInFactorsCard /g) || []).length, 1);
  const auth = slice(CODE, 'function AuthSection(', 'function NotificationsSection(');
  assert.ok(auth.indexOf('<SignInFactorsCard') < auth.indexOf('<ConnectedAccountsPanel'), 'status rows first');
  const f = slice(CODE, 'function SignInFactorsCard(', 'function AuthSection(');
  assert.match(f, /const paired = factorDate\(data\.totp_paired_at\);/, 'the pairing date is the served one, and only that');
  assert.doesNotMatch(f, /new Date\(\)/, 'no clock reads: a date the worker did not serve is not drawn');
  assert.match(f, /Paired \$\{paired\}/);
  assert.match(f, /date not recorded for this enrolment/, 'a configured factor with no stamp says so rather than inventing one');
  assert.match(f, /remaining > 0 \? `\$\{remaining\} remaining` : 'None generated'/);
  assert.doesNotMatch(f, /api\./, 'no second fetch: the panels below own their stores');
});

test('the password row is an honest absence with its reason on screen', () => {
  const f = slice(CODE, 'function SignInFactorsCard(', 'function AuthSection(');
  assert.match(f, /key: 'password',\s*label: 'Password',\s*status: null,/);
  assert.match(f, /issues no password credential/);
  assert.match(f, /<Unrecorded reason=\{r\.reason\}>Not recorded<\/Unrecorded> — \{r\.reason\}\./, 'the reason is printed, not only in a title');
});

test('the worker serves totp_paired_at on the root payload the page reads', () => {
  assert.match(WORKER, /totp_paired_at: totpPairedAt,/);
  assert.match(WORKER, /import \{[^}]*loadTotpPairedAt[^}]*\} from '\.\.\/services\/authTotp'/);
});

// ---------------------------------------------------------------------------
// 4. Roles & access, API keys.
// ---------------------------------------------------------------------------

test('Roles & access records the one role and says what has no store', () => {
  const r = slice(CODE, 'function RolesAccessCard(', 'function DocumentsAgreementsSection(');
  assert.match(r, /ROLE_LABEL\[role\] \|\| role \|\| 'Not recorded'/);
  assert.match(r, /data-testid="roles-additional"/);
  assert.match(r, /one role per account; the platform has no store for a second role yet/);
  assert.match(r, /data-testid="roles-delegates"/);
  assert.match(r, /no delegate store yet; nobody can act on this account’s behalf/);
  assert.doesNotMatch(r, /delegates\.map|roles\.map|plans\.map/, 'no empty list drawn over a missing store');
  assert.match(CODE, /<RolesAccessCard data=\{data\} onJump=/, 'mounted on the account pane');
});

test('the API-keys card is drawn in either state of the flag, and reads "Not recorded" with the reason', () => {
  const i = slice(CODE, 'function IntegrationsTab()', 'function BillingTab(');
  assert.doesNotMatch(i, /apiKeysEnabled &&|No keys yet/);
  assert.doesNotMatch(i, /&&\s*<Card title="API keys"/, 'the card is behind a flag again');
  assert.match(i, /^\s*<Card title="API keys"/m, 'the card is drawn unconditionally');
  assert.match(i, /data-testid="api-keys-card"/);
  assert.match(i, /<Unrecorded reason="no key store yet">Not recorded<\/Unrecorded>/);
  assert.match(i, /no key store exists yet, so no key can be created or listed\./);
  assert.match(i, /the API tier \(T20\) has not shipped, and its flag is off for this account\./);
  // The worker's flag is still off; when it flips, the card still tells the truth.
  assert.match(WORKER, /api_keys_enabled: false/);
});

// ---------------------------------------------------------------------------
// 5. Voice.
// ---------------------------------------------------------------------------

test('no notification label calls anything a recommendation, advice, or an AI\'s output', () => {
  // "Advisor" on its own is a ROLE on this platform (advisor sessions, the
  // advisor NDA), so the rule is the voice rule about the machine: nothing it
  // produces is a recommendation or advice, and it is not named "AI".
  const labels = [...PAGE.matchAll(/\{ key: '[a-z_]+', label: '([^']+)' \}/g)].map((m) => m[1]);
  assert.ok(labels.length >= 15, `only ${labels.length} labels found`);
  for (const l of labels) {
    assert.doesNotMatch(l, /recommend|advice|fiduciary|\bAI\b/i, `"${l}"`);
  }
  assert.match(PAGE, /\{ key: 'partner_match_recommendation', label: 'New partner match' \}/);
});

// ---------------------------------------------------------------------------
// Retired: /profile.
// ---------------------------------------------------------------------------

test('/profile redirects to /account with query and hash, and the sidebar row points where it lands', () => {
  assert.match(APP, /<Route path="\/profile" element=\{<SettingsRedirect \/>\} \/>/);
  assert.doesNotMatch(APP, /path="\/profile" element=\{guard\(/, 'the second SettingsPage mount is gone');
  const redirect = slice(APP, 'function SettingsRedirect()', 'function SettingsSectionRedirect()');
  assert.match(redirect, /pathname: '\/account', search: loc\.search, hash: loc\.hash/);
  assert.doesNotMatch(SIDEBAR, /to: '\/profile'/);
  assert.match(SIDEBAR, /\{ to: '\/account', icon: UserCircle, label: 'My Profile' \}/);
});
