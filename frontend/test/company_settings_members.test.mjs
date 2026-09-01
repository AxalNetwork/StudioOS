/**
 * Company Settings: members are rendered, and the empty state is a door (Wave 2).
 *
 * The P−1 census graded this canvas UPGRADE and called out one zone as a pure
 * RESKIN: "Member CRUD already exists with no UI". That was understated in an
 * interesting way — `GET /company/:uid` returns `members[]` on every load, and
 * the page was already calling it and rendering the profile fields from the
 * same response. The member list was **in the component's state and simply
 * never drawn**. Nothing had to be fetched to fix it.
 *
 * Two things this pins beyond "the UI exists":
 *
 *   1. The add-member copy must not promise an invitation. The worker resolves
 *      the address to an EXISTING user and 404s otherwise — no invitation row
 *      is written and no mail is sent. A UI that says "invite" would be
 *      describing a feature the backend does not have.
 *   2. The last primary admin cannot be demoted or removed. The worker enforces
 *      both; the UI must not offer a control that can only fail.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const PAGE = 'frontend/src/pages/CompanySettingsPage.jsx';

test('the members list is actually rendered from the loaded company', () => {
  const s = read(PAGE);
  assert.match(s, /row\.members/, 'the page must read members off the company detail');
  for (const field of ['is_primary_admin', 'role_in_company', 'user_id']) {
    assert.ok(s.includes(field), `the member row must surface ${field}`);
  }
});

test('every member mutation the backend offers has a control', () => {
  const s = read(PAGE);
  for (const m of ['addCompanyMember', 'updateCompanyMember', 'removeCompanyMember']) {
    assert.ok(s.includes(`api.${m}(`), `${m} has no UI — that was the RESKIN`);
  }
});

test('the add-member copy does not promise an invitation', () => {
  // The worker 404s an unregistered address. Saying "invite" here would
  // describe a flow that does not exist.
  const s = read(PAGE);
  assert.match(
    s, /does not send an invitation/i,
    'the caveat that this links an existing account must stay',
  );
});

test('the empty state offers the action its backend supports, and only that', () => {
  const s = read(PAGE);
  assert.ok(s.includes('api.createCompany('), 'POST /company/create has been live with no UI');
  // Joining has no endpoint. The page must say so rather than render a button
  // that cannot work.
  assert.match(s, /no self-serve join request/i, 'the join caveat must stay until an endpoint exists');
});

test('the last primary admin cannot be removed from the UI', () => {
  const s = read(PAGE);
  assert.match(
    s, /is_primary_admin && primaryAdmins <= 1/,
    'the remove control must disable for the only primary admin — the worker rejects it',
  );
});

test('the worker guards the new role endpoint exactly like the others', () => {
  const w = read('cloudflare-worker/src/routes/company.ts');
  const i = w.indexOf("r.patch('/company/:uid/members/:userId'");
  assert.ok(i > 0, 'PATCH /company/:uid/members/:userId must exist');
  const body = w.slice(i, w.indexOf("r.delete('/company/:uid/members/:userId'", i));

  assert.match(body, /canEdit\(/, 'the route must gate on canEdit');
  assert.match(
    body, /Only the primary admin can grant primary admin status/,
    'granting primary-admin must require being one — same rule POST enforces',
  );
  assert.match(
    body, /Cannot demote the only primary admin/,
    'demoting the last primary admin must be rejected — a company with none has nobody who can appoint one',
  );
  // No id may come from the request body: the target is the URL param, and the
  // company is resolved from its uid.
  assert.ok(
    !/body\.(company_id|user_id)/.test(body),
    'the target must come from the URL, never from the request body',
  );
});

test('the new api method exists on both sides of the drift boundary', () => {
  assert.match(
    read('frontend/src/lib/api.js'),
    /updateCompanyMember:\s*\(uid, userId, data\)/,
    'api.js must expose updateCompanyMember',
  );
  assert.match(
    read('cloudflare-worker/src/routes/company.ts'),
    /r\.patch\('\/company\/:uid\/members\/:userId'/,
    'the worker must serve it',
  );
});

/* ------------------------------------------------------------------ *
 * Settings: the two Account panes the canvas asked for (Wave 2)       *
 * ------------------------------------------------------------------ */

test('Settings renders Your companies and Documents & agreements', () => {
  // Before Wave 2, SettingsPage.jsx made ZERO company or e-sign calls — both
  // canvas panes were absent while both backends were live.
  const s = read('frontend/src/pages/SettingsPage.jsx');
  assert.ok(s.includes('api.listMyCompanies('), 'GET /company/memberships had no consumer');
  assert.ok(s.includes('api.esignList('), 'GET /legal/esign had no consumer in Settings');
  assert.ok(s.includes('<YourCompaniesSection'), 'the pane must be mounted, not just defined');
  assert.ok(s.includes('<DocumentsAgreementsSection'), 'the pane must be mounted, not just defined');
});

test('Your companies reads the shape the worker actually returns', () => {
  // Both of these were wrong in the first draft and would have failed SILENTLY
  // — an unresolved field renders as nothing, so the pane would have looked
  // fine while showing no roles at all. /company/memberships returns a BARE
  // ARRAY and names the caller's role `my_role`.
  const w = read('cloudflare-worker/src/routes/company.ts');
  const i = w.indexOf("r.get('/company/memberships'");
  assert.notEqual(i, -1, 'the memberships handler is gone');
  // Read to the NEXT route registration, not a fixed byte count. This was
  // `w.slice(i, i + 1200)`, which is a bet that the handler stays under 1200
  // characters — a bet lost the moment a comment was added above the line
  // being asserted, with nothing about the response shape having changed.
  // Route registrations sit at column 0, so the next one is an exact bound and
  // the window can never run into a neighbouring handler either.
  const next = w.slice(i + 1).search(/\nr\.(get|post|put|patch|delete)\(/);
  const body = next === -1 ? w.slice(i) : w.slice(i, i + 1 + next);
  // Anchored on the trailing comma: without it the pattern is a PREFIX match
  // and `link.role_in_company_WRONG` satisfies it, which is exactly what a
  // canary of this line demonstrated.
  assert.match(body, /my_role: link\.role_in_company,/, 'the worker exposes the role as my_role');
  assert.match(body, /return c\.json\(out\)/, 'the worker returns a bare array, not {items}');

  const s = read('frontend/src/pages/SettingsPage.jsx');
  assert.match(s, /Array\.isArray\(r\)/, 'the pane must handle the bare-array response');
  assert.match(s, /c\.my_role/, 'the pane must read my_role, not role_in_company');
});

test('Settings does not become a second company switcher', () => {
  // Company context changes through ui/CompanySwitcher.jsx and nowhere else.
  // This pane reports membership and links out; it must not call setCompany.
  const s = read('frontend/src/pages/SettingsPage.jsx');
  const i = s.indexOf('function YourCompaniesSection');
  const body = s.slice(i, s.indexOf('function DocumentsAgreementsSection'));
  assert.ok(!/setCompany\(/.test(body), 'switching belongs to CompanySwitcher alone');
  assert.ok(!/useActiveCompany\(/.test(body), 'the pane lists memberships; it does not own active context');
});

/* ------------------------------------------------------------------ *
 * Notification presets (Wave 2)                                       *
 * ------------------------------------------------------------------ */

test('presets write the same prefs shape the grid writes', () => {
  // No second storage shape and no migration: a preset patches
  // `notification_prefs`, exactly as a checkbox does.
  const s = read('frontend/src/pages/SettingsPage.jsx');
  assert.match(s, /patch\(\{ notification_prefs: next \}\)/);
  assert.ok(s.includes('const applyPreset'), 'presets must exist');
  // in_app/inapp are mirrored by the grid for the legacy reader; a preset that
  // set only one of them would desync the bell subsystem.
  const i = s.indexOf('const NOTIFICATION_PRESETS');
  const block = s.slice(i, s.indexOf('const ActivityPage'));
  const applies = block.match(/in_app: (true|false), inapp: (true|false)/g) || [];
  assert.ok(applies.length >= 4, 'every preset must set in_app and inapp together');
  for (const a of applies) {
    const [, x, y] = a.match(/in_app: (true|false), inapp: (true|false)/);
    assert.equal(x, y, `preset desyncs in_app/inapp: ${a}`);
  }
});

test('the per-event grid survives the presets', () => {
  // The canvas says presets "replace" the matrix. They do not: the grid is the
  // only way to express "email capital calls but not the digest", and dropping
  // it to match a canvas would be a downgrade sold as a redesign.
  const s = read('frontend/src/pages/SettingsPage.jsx');
  assert.match(s, /renderTable\(NOTIFICATION_EVENTS\)/, 'the event grid must stay');
  assert.match(s, /renderTable\(PARTNER_NOTIFICATION_EVENTS\)/, 'the partner grid must stay');
  assert.match(s, /stays editable/i, 'the UI must say the switches remain editable');
});

test('a preset covers exactly the events the user can see', () => {
  // Applying a preset must not leave the partner block out of step with the
  // core grid — the stored prefs and the visible switches have to agree.
  const s = read('frontend/src/pages/SettingsPage.jsx');
  const i = s.indexOf('const applyPreset');
  const body = s.slice(i, i + 700);
  assert.match(body, /NOTIFICATION_EVENTS\.map/);
  assert.match(body, /data\.role === 'partner' \? PARTNER_NOTIFICATION_EVENTS\.map/);
});
