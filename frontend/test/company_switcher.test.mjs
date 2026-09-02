/**
 * CompanySwitcher — creation works, and the switcher does not overclaim.
 *
 * Two separate facts are pinned here because they failed together in the
 * product: "Add a new company" was hardcoded `disabled` with the title
 * "Creating additional companies is coming soon", while `POST /company/create`
 * on the worker had been complete the whole time — it inserts the
 * `company_profiles` row AND the `user_company_links` row that makes the
 * creator its primary admin. The feature read as unbuilt because of one
 * attribute.
 *
 * The second fact is the one that matters more. Enabling creation is only safe
 * while the UI is honest about what selecting a company does. When this file
 * was written that was "almost nothing": no business table carried a
 * `company_id` at all, so a second company showed the first one's rows, which
 * reads as data loss. Migration 189 and `companyScope` started closing that,
 * but starting is not finishing — most route files still ignore the active
 * company, so the notice still has to stand.
 *
 * The notice and the ROLLOUT are therefore asserted as one coupled fact, and
 * the coupling is measured rather than declared. The first version asked a
 * yes/no question — "does any company scoping exist?" — and went red the
 * moment the first route adopted it, demanding the notice be deleted while 50
 * of 51 route files still ignored the active company. The last test now counts
 * the route files that read `projects` and narrow through `companyScope`, and
 * requires the notice gone only when every one of them does.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const switcher = read('frontend/src/ui/CompanySwitcher.jsx');
const api = read('frontend/src/lib/api.js');

test('the add-company control is not disabled', () => {
  assert.ok(
    !/Creating additional companies is coming soon/.test(switcher),
    'the "coming soon" title is gone',
  );
  // `disabled` on the SUBMIT button is correct (empty name / in-flight save).
  // What must not come back is a bare `disabled` with no expression, which is
  // how the add button was switched off.
  assert.ok(
    !/^\s*disabled\s*$/m.test(switcher),
    'no unconditionally-disabled button remains',
  );
});

test('creating a company posts to the endpoint that also links the creator', () => {
  assert.match(switcher, /api\.createCompany\(/, 'the switcher calls createCompany');
  assert.match(
    api, /createCompany:\s*\(data\)\s*=>\s*request\('\/company\/create'/,
    'createCompany targets /company/create',
  );
});

test('the new company becomes the active one', () => {
  // Creating a company and leaving the previous one selected would look like
  // the create silently failed.
  assert.match(switcher, /setCompany\(created\)/);
  assert.match(switcher, /setCompanies\(\[\.\.\.companies, created\]\)/);
});

/**
 * Route files that read `projects`, filter on FOUNDER OWNERSHIP, and are still
 * allowed not to narrow — each with the reason it is exempt.
 *
 * The list is deliberately tiny and every entry was checked by reading the
 * file. An allowlist that grows is a rollout going backwards, so adding to it
 * should feel like a decision rather than a formality.
 */
const WIDE_ON_PURPOSE = {
  'capital.ts': 'the project read sits inside an admin-only handler',
  'founder_risk.ts': "keys its payload on founder_id — a risk profile belongs to the person, not to one of their companies; the projects join is only a lookup from a deal to its owner",
  'public.ts': 'the unauthenticated public profile facade — there is no active company to scope by, and the profile is the person\'s',
};

test('the scope notice stands exactly as long as scoping is incomplete', () => {
  // THIS GUARD HAS BEEN WRONG TWICE, in opposite directions, and both
  // corrections are the reason it looks like this.
  //
  // First it asked a yes/no question — "does any company scoping exist?" — and
  // went red the moment the first route adopted it, demanding the notice be
  // deleted while 50 of 51 route files still ignored the active company.
  //
  // Then it measured `companyScope` SPECIFICALLY. But the rollout narrowed
  // through `projectInActiveCompany`, `activeCompanyFor`, `resolveActiveCompany`
  // and the investor helpers instead, so the guard could never go green no
  // matter how complete the scoping became — it would have kept a true-sounding
  // but false notice on screen forever. A guard that cannot be satisfied is not
  // a strict guard, it is a broken one.
  //
  // It now measures two things that are actually true of a finished rollout:
  // the real vocabulary, and only the files where company scoping is even the
  // right question. A file that reads `projects` but never filters on founder
  // ownership is not a founder-ownership surface — it reaches projects through
  // a share token, a public listing, an admin console or an investor
  // relationship — so it is not evidence of an unfinished rollout.
  const SCOPED = /companyScope|projectInActiveCompany|activeCompanyFor|resolveActiveCompany|investorActiveCompany|investorProjectIds/;
  const FOUNDER_OWNED = /founder_id\s*=\s*[?$]|user\.founder_id/;

  const routes = readdirSync(resolve(root, 'cloudflare-worker/src/routes'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ f, src: codeOnly(read(`cloudflare-worker/src/routes/${f}`)) }));
  const queriesProjects = routes.filter(({ src }) => /\b(FROM|JOIN)\s+projects\b/.test(src));
  const founderOwned = queriesProjects.filter(({ src }) => FOUNDER_OWNED.test(src));
  const unscoped = founderOwned
    .filter(({ src }) => !SCOPED.test(src))
    .filter(({ f }) => !(f in WIDE_ON_PURPOSE));

  assert.ok(queriesProjects.length > 0, 'sanity: some route reads projects');
  assert.ok(founderOwned.length > 0, 'sanity: some route filters projects by founder ownership');

  // The allowlist must not rot: an entry for a file that has since started
  // narrowing, or stopped reading projects at all, is a stale claim.
  for (const [f, why] of Object.entries(WIDE_ON_PURPOSE)) {
    const row = queriesProjects.find((r) => r.f === f);
    assert.ok(row, `${f} is allowlisted but no longer reads projects — drop the entry (${why})`);
    assert.ok(!SCOPED.test(row.src), `${f} now narrows by company — drop it from WIDE_ON_PURPOSE`);
  }

  const hasNotice = /SHARED_NOTICE/.test(switcher);
  if (unscoped.length === 0) {
    assert.ok(
      hasNotice,
      'every founder-ownership surface now narrows by company — the "still rolling out" ' +
      'notice is no longer true and must be replaced (not simply deleted: shared ' +
      'marketplaces and account-level data stay the same in every company by design, ' +
      'and the advisor Practice/Expertise rows really are unseparated because they run ' +
      'on frozen code — task #124, UNRESOLVED_ITEMS.md U4)',
    );
  } else {
    assert.ok(
      /SCOPE_NOTICE/.test(switcher),
      `${unscoped.map((r) => r.f).join(', ')} filter projects by founder ownership and ` +
      'still ignore the active company, so the switcher must keep saying separation ' +
      'is incomplete',
    );
  }
});
