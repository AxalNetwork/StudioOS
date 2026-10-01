/**
 * D434 — Company Settings: the header chrome, removal with its consequence,
 * the Workspace card, and the direct "Add team member" retired.
 *
 * FOUR THINGS, PINNED TO THE PROPERTY.
 *
 * 1. THE HEADER READS THE MEMBERSHIP ROW THE SWITCHER SELECTED — name, stage,
 *    created date, the reader's role — with an honest absence for each field
 *    that is not recorded, and no second read that could disagree with the
 *    sidebar. "Switch company" jumps to the switcher's own trigger rather than
 *    drawing a second one, and says so when there is none on screen.
 *
 * 2. REMOVAL IS TWO STEPS AND THE CONSEQUENCE IS PRINTED. One click used to
 *    remove a member. The row now opens an inline confirmation naming the
 *    person and the company and saying what they lose; the reader's own row
 *    points at Leave company instead. Revoking an invitation gets the same
 *    shape with the invitation's own consequence.
 *
 * 3. THE WORKSPACE CARD CREATES THROUGH THE ONE WRITER'S RULES (append to the
 *    context list, persist the id, select) and counts from the list the
 *    switcher loaded, saying "could not be read" rather than counting one
 *    when that list is empty on a page that has an active company.
 *
 * 4. THE DIRECT ADD IS GONE ON EVERY SIDE. `CompanyProfilePanel`'s modal
 *    joined an existing account without asking it; the panel now points at
 *    Company Settings, `api.addCompanyMember` has no caller and is removed,
 *    and the worker no longer mounts POST /company/:uid/members. D69 kept the
 *    method for that one surface; D434 retires the surface on D304's rule.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = read('frontend/src/pages/CompanySettingsPage.jsx');
const CODE = codeOnly(PAGE);
const PANEL = codeOnly(read('frontend/src/components/CompanyProfilePanel.jsx'));
const API = codeOnly(read('frontend/src/lib/api.js'));
const WORKER = codeOnly(read('cloudflare-worker/src/routes/company.ts'));
const SWITCHER = codeOnly(read('frontend/src/ui/CompanySwitcher.jsx'));

function slice(src, from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + 1);
  assert.ok(a >= 0 && b > a, `could not slice ${from} → ${to}`);
  return src.slice(a, b);
}

function helpers() {
  const src = slice(CODE, 'function initialsOf', 'function jumpToSwitcher');
  return new Function(`${src}; return { initialsOf, createdOn };`)();
}

// ---------------------------------------------------------------------------
// 1. Header.
// ---------------------------------------------------------------------------

test('the header is drawn from the active membership row, once, above the toast', () => {
  const page = slice(CODE, 'export default function CompanySettingsPage', 'function initialsOf');
  assert.equal((CODE.match(/<CompanyHeader /g) || []).length, 1, 'mounted exactly once');
  assert.match(page, /<CompanyHeader company=\{activeCompany\} \/>/);
  assert.ok(page.indexOf('<CompanyHeader') < page.indexOf('{toast && <Toast'), 'header first');
  assert.doesNotMatch(page, /Profile and details for/, 'the old one-line subtitle is gone');
  const h = slice(CODE, 'function CompanyHeader(', 'function CompanyOnRamp(');
  assert.doesNotMatch(h, /api\./, 'no second read: the header cannot disagree with the sidebar');
  for (const id of ['company-header-name', 'company-header-stage', 'company-header-binding', 'company-header-role', 'company-header-scope']) {
    assert.match(h, new RegExp(`data-testid="${id}"`), id);
  }
});

test('each header field has an honest absence, and the role comes from the membership', () => {
  const h = slice(CODE, 'function CompanyHeader(', 'function CompanyOnRamp(');
  assert.match(h, /Stage not recorded/);
  assert.match(h, /creation date not recorded/);
  assert.match(h, /'Your role: not recorded'/);
  assert.match(h, /company\.is_primary_admin\s*\?\s*'Primary admin'/);
  assert.match(h, /company\.my_role \? String\(company\.my_role\) : null/);
  // The canvas's Owner-view / CTO-view toggle is demo scaffolding.
  assert.doesNotMatch(CODE, /roleViews|CTO view|Owner view/);
});

test('initials and the created date are pure and honest', () => {
  const { initialsOf, createdOn } = helpers();
  assert.equal(initialsOf('Novacraft Labs, Inc.'), 'NL');
  assert.equal(initialsOf('  halyard  '), 'H');
  assert.equal(initialsOf(''), '?');
  assert.equal(createdOn(null), null);
  assert.equal(createdOn('not a date'), null);
  assert.equal(typeof createdOn('2026-03-12 10:00:00'), 'string');
});

test('"Switch company" jumps to the switcher\'s own trigger and says when there is none', () => {
  const j = slice(CODE, 'function jumpToSwitcher()', 'function CompanyHeader(');
  assert.match(j, /document\.querySelector\('\[data-company-switcher\]'\)/);
  assert.match(j, /if \(!el\) return false;/);
  assert.match(j, /el\.click\(\)/, 'it opens the switcher, not only scrolls to it');
  assert.equal((SWITCHER.match(/data-company-switcher=""/g) || []).length, 2, 'both trigger buttons (collapsed and expanded) carry the anchor');
  const h = slice(CODE, 'function CompanyHeader(', 'function CompanyOnRamp(');
  assert.match(h, /setJumpFailed\(!jumpToSwitcher\(\)\)/);
  assert.match(h, /The switcher is in the sidebar, which is not open on this screen\./);
  assert.doesNotMatch(h, /<select|listMyCompanies/, 'no second switcher on this page');
});

// ---------------------------------------------------------------------------
// 2. Removal.
// ---------------------------------------------------------------------------

test('removing a member is two steps, and the consequence names the company', () => {
  const m = slice(CODE, 'function MembersCard(', '\n}\n');
  assert.match(m, /const \[removing, setRemoving\] = useState\(null\);/);
  assert.match(m, /onClick=\{\(\) => setRemoving\(removing === m\.user_id \? null : m\.user_id\)\}/, 'Remove opens the confirmation');
  assert.match(m, /data-testid=\{`remove-confirm-\$\{m\.user_id\}`\}/);
  assert.match(m, /Remove \{m\.name \|\| m\.email\} from \{companyShort\}\?/);
  assert.match(m, /They immediately lose access to every workspace scoped to \$\{companyShort\}/);
  assert.match(m, /Adding them back means a new invitation\./);
  assert.match(m, /: removeConsequence\(\)\}/, 'the confirmation prints the consequence, not a bare "are you sure"');
  // The write happens only inside the confirmation.
  const confirmBlock = slice(m, 'remove-confirm-', 'Keep them');
  assert.match(confirmBlock, /api\.removeCompanyMember\(uid, m\.user_id\)/);
  assert.equal((m.match(/api\.removeCompanyMember\(/g) || []).length, 1, 'one removal write, behind the confirmation');
  // Your own row points at Leave company rather than removing you here.
  assert.match(confirmBlock, /use Leave company below instead/);
  assert.match(confirmBlock, /\{!isYou && \(/);
});

test('revoking an invitation is two steps with the invitation\'s own consequence', () => {
  const m = slice(CODE, 'function MembersCard(', '\n}\n');
  assert.match(m, /const \[revoking, setRevoking\] = useState\(null\);/);
  assert.match(m, /onClick=\{\(\) => setRevoking\(revoking === i\.uid \? null : i\.uid\)\}/);
  assert.match(m, /data-testid=\{`revoke-confirm-\$\{i\.uid\}`\}/);
  assert.match(m, /They never had access, so nothing they own is affected\./);
  const block = slice(m, 'revoke-confirm-', 'Keep it');
  assert.match(block, /api\.revokeCompanyInvitation\(uid, i\.uid\)/);
  assert.equal((m.match(/api\.revokeCompanyInvitation\(/g) || []).length, 1);
});

test('the members description counts members and pending invitations from the loaded lists', () => {
  const m = slice(CODE, 'function MembersCard(', '\n}\n');
  assert.match(m, /const pendingInvites = invites\.state === 'ready' \? invites\.items\.filter\(\(i\) => i\.status === 'pending'\)\.length : 0;/,
    'a failed invitation read counts as nothing pending, not as zero pending');
  assert.match(m, /\$\{pendingInvites === 1 \? 'invitation' : 'invitations'\} pending/);
  assert.match(m, /you can invite, change roles and remove people\./);
  assert.match(m, /only Owner, Admin and Founder roles can change this list\./);
});

// ---------------------------------------------------------------------------
// 3. Workspace.
// ---------------------------------------------------------------------------

test('the Workspace card creates through the switcher\'s own rules and counts honestly', () => {
  assert.match(CODE, /<WorkspaceCard row=\{row\} flash=\{flash\} \/>/, 'mounted on the settings page');
  const w = slice(CODE, 'function WorkspaceCard(', 'function DangerZoneCard(');
  assert.match(w, /const \{ companies, setCompanies, setCompany \} = useActiveCompany\(\);/);
  assert.match(w, /api\.createCompany\(\{ company_name \}\)/);
  assert.match(w, /setCompanies\(\[\.\.\.\(companies \|\| \[\]\), created\]\);\s*setActiveCompanyId\(created\.id\);\s*setCompany\(created\);/,
    'append, persist, select — the one-writer rule the switcher keeps');
  assert.match(PAGE, /import \{ api, setActiveCompanyId \} from '\.\.\/lib\/api';/);
  assert.match(w, /data-testid="workspace-count"/);
  assert.match(w, /The number of companies on this account could not be read\./, 'an empty list with an active company is a failed read');
  assert.match(w, /count > 0\s*\?/);
  assert.doesNotMatch(w, /listMyCompanies/, 'the count is the list the switcher loaded, not a second read');
  assert.match(w, /Jump to the switcher/);
  assert.match(w, /Create another company/);
});

// ---------------------------------------------------------------------------
// 4. The direct add, retired.
// ---------------------------------------------------------------------------

test('the direct add is gone from the panel, the client and the worker', () => {
  assert.doesNotMatch(PANEL, /AddMemberModal|addCompanyMember|Add member|Add team member|showAdd/);
  assert.match(PANEL, /href="\/company-settings"[^>]*>\s*Invite from Company Settings/, 'the panel points at the invitation');
  assert.doesNotMatch(API, /addCompanyMember:|`\/company\/\$\{uid\}\/members`, \{ method: 'POST'/);
  assert.doesNotMatch(WORKER, /r\.post\('\/company\/:uid\/members'/);
  // The two member mutations that were never the defect stay mounted.
  assert.match(WORKER, /r\.patch\('\/company\/:uid\/members\/:userId'/);
  assert.match(WORKER, /r\.delete\('\/company\/:uid\/members\/:userId'/);
  assert.match(WORKER, /r\.post\('\/company\/:uid\/invitations'/, 'the invitation is the way in');
});

test('the on-ramp and the unlock copy describe the invitation that exists, and still no join request', () => {
  const ramp = slice(CODE, 'function CompanyOnRamp(', 'const UNLOCKS = [');
  assert.match(ramp, /invite the email address on this account under Members/);
  assert.match(ramp, /nothing changes until you do/);
  assert.match(ramp, /no self-serve join request yet/);
  const unlocks = slice(CODE, 'const UNLOCKS = [', 'function Toast(');
  assert.match(unlocks, /Invite co-founders and hires by email — they accept a link, nobody is joined without asking/);
  // The stale comment: it used to say no invitation-accept endpoint existed.
  assert.doesNotMatch(PAGE, /has no join-request or invitation-accept endpoint/);
  assert.match(read('frontend/src/App.jsx'), /path="\/company\/invitations\/accept"/, 'the accept route the copy relies on');
});

test('the logo field says why there is no upload', () => {
  const p = slice(CODE, 'function CompanyProfileCard(', 'function ViewOnlyNotice(');
  assert.match(p, /label="Logo URL" hint="Upload is not available: there is no image store for company logos yet/);
  assert.doesNotMatch(p, /type="file"/);
});
