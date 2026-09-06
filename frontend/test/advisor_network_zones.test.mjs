/**
 * Network and Research: the zone you clicked is the zone you get.
 *
 * WHAT THESE PIN, each of which was false in shipped code when written:
 *
 *   * a Network zone renders its own body — `/network/relationships` showed the
 *     INTRODUCTIONS tab, because the tab came from `?tab=` and never from the
 *     path, and the fallback for a role without Contacts is Introductions;
 *   * the rail never describes a body it is wrong about, in either direction —
 *     it called zones with a relationship editor and a credit-spending Accept
 *     button "read-only", and called Organizations covered where nothing
 *     backs it;
 *   * a component mounted with `embedded` actually destructures it — two did
 *     not, independently, and one of them was also missing `user`, which is
 *     what silently served every role the founder view of Signals;
 *   * a referral is never attached to a relationship row, because no join key
 *     exists and matching on a typed name would credit the wrong person;
 *   * the withdrawn Research tabs stay withdrawn (D12) while the reason the
 *     first-party version is different stays written down.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { allZoneRoutes } from '../src/workspaces/shellConfig.js';

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const netWorkspace = read('frontend/src/workspaces/NetworkWorkspace.jsx');
const netPage = read('frontend/src/pages/NetworkPage.jsx');
const research = read('frontend/src/workspaces/ResearchWorkspace.jsx');
const app = read('frontend/src/App.jsx');

test('an advisor Network zone renders its own body, not the next zone along', () => {
  const zones = allZoneRoutes('advisor')
    .filter((r) => r.startsWith('/network/'))
    .map((r) => r.slice('/network/'.length));
  assert.deepEqual(zones, ['relationships', 'introductions', 'organizations']);

  // A dispatch map keyed by slug, with an entry for every declared zone. The
  // advisor arm previously ignored `slug` entirely and returned one component
  // for all three, which is how three routes rendered one page.
  const code = codeOnly(netWorkspace);
  const block = code.slice(code.indexOf('const ADVISOR_ZONE = {'), code.indexOf('const ORG_BACKED'));
  assert.ok(block.length > 0, 'the advisor dispatch map must exist');
  for (const z of zones) {
    assert.match(block, new RegExp(`\\b${z.replace('-', '')}: Advisor`),
      `${z} must dispatch to its own component`);
  }
  assert.match(code, /if \(role === 'advisor'\) \{\s*const Zone = ADVISOR_ZONE\[slug\]/,
    'the advisor arm must select on the slug the shell already resolved');

  // And each of the three files exists and is a distinct default export.
  const seen = new Set();
  for (const f of ['RelationshipsZone', 'IntroductionsZone', 'OrganizationsZone']) {
    const p = `frontend/src/pages/advisor/network/${f}.jsx`;
    assert.ok(existsSync(resolve(root, p)), `${p} is missing`);
    const src = read(p);
    assert.match(src, /export default function/, `${f} must have a default export`);
    assert.ok(!seen.has(src), `${f} must not be a copy of a sibling zone`);
    seen.add(src);
  }
});

test('the shared Network page takes its tab from the path, not only from ?tab=', () => {
  const code = codeOnly(netPage);
  // The query param still wins — notification deep links depend on it — but the
  // pathname must be the fallback beneath it rather than the hardcoded default.
  assert.match(code, /location\.pathname\.startsWith\('\/network\/'\)/,
    'the path must be read at all');
  assert.match(code, /const requested = params\.get\('tab'\) \|\| fromPath;/,
    'the query param leads and the path follows — in that order');

  // A zone this page has no tab for must say so rather than silently showing a
  // different tab under that zone's heading. Organizations is the live case.
  assert.match(code, /unservedZone/, 'a zone with no tab here must be named');
  assert.match(netPage, /No store behind this yet/);
});

test('an unserved zone renders its card ALONE when the shell supplies the navigation', () => {
  const code = codeOnly(netPage);
  // /network/organizations is a real route on every licence and this page has
  // no tab for it, so `activeTab` falls to the default — Introductions for a
  // role that cannot see Contacts. Embedded, the tab row is suppressed because
  // the shell's zone pills already are that navigation, so an operator read
  // the no-store card and then an UNLABELLED introductions list: a body the
  // heading above it does not name. That is the same defect this bucket was
  // reported for, surviving in the one zone that has no body at all.
  assert.match(code, /const unservedAlone = embedded && Boolean\(unservedZone\)/);
  const suppressed = code.match(/!unservedAlone && activeTab === /g) || [];
  assert.equal(suppressed.length, 3,
    'every panel must be suppressed on an unserved zone, not just the one that happens to be the default');
});

test('the unserved-zone card never points at a tab row that is not rendered', () => {
  // The note read "The tabs below are what this page actually holds" — true on
  // this page's own mount, false inside the shell where no tab row renders.
  assert.match(netPage, /unservedAlone\s*\n?\s*\? 'Relationships and Introductions above/,
    'embedded, the fallback the reader can actually reach is the shell zone pills above');
  assert.match(netPage, /: 'The tabs below are what this page actually holds/,
    'and on its own mount the tab row IS below, so that wording stays');
});

test('the Network rail never claims read-only over a body that writes', () => {
  const code = codeOnly(netWorkspace);
  // The old copy said the VIEW does not change records, above a relationship
  // editor and an Accept button that spends a credit. The rail is what acts on
  // nothing; the page acts on a click, and the sentence has to separate them.
  assert.doesNotMatch(code, /does not draft outreach, send messages, or change records/);
  assert.match(code, /stance="Stored records only"/);
  assert.match(netWorkspace, /it writes on your click, never on the rail's/);

  // Organizations is covered only where an organisation store is reachable.
  assert.match(code, /const ORG_BACKED = new Set\(\['founder', 'investor'\]\)/);
  assert.match(code, /orgGap\s*\?\s*'Organizations · no store behind it on this licence'/,
    'a licence with no organisation store must not be told the zone is covered');
});

test('a Network zone that reads nothing says which edge is missing', () => {
  const org = codeOnly(read('frontend/src/pages/advisor/network/OrganizationsZone.jsx'));
  assert.match(org, /No store behind this yet/);
  // The specific fact, not a vague "coming soon": there is no person→org edge.
  assert.match(org, /link from a person you know to\s*\n?\s*the organisation they are in|edge\s*\n?\s*from a person to an organisation/);
  // And it must NOT quietly read the global company directory to look full.
  assert.doesNotMatch(org, /api\.listCompanies|\/api\/companies/,
    'a global directory is not "the organisations you know"');
});

test('a referral is never attached to a relationship row', () => {
  const rel = codeOnly(read('frontend/src/pages/advisor/network/RelationshipsZone.jsx'));
  // Both stores are read, and the counts are real…
  assert.match(rel, /api\.partnerRelationships\(\)/);
  assert.match(rel, /api\.referralSubmissions\(\)/);
  // …but nothing may match a referral to a relationship. `referral_submissions`
  // stores `referred_name`/`referred_org` as free text with no user id, so any
  // such match is on a typed name and will eventually credit the wrong person.
  assert.doesNotMatch(rel, /referred_name\s*===|referred_name\s*==|\.find\(\s*\(?r\)?\s*=>[^)]*referred_name/,
    'no name-matching between a referral and a relationship');
  assert.doesNotMatch(rel, /other\?\.name\s*===\s*\w+\.referred_name/);
  assert.match(rel, /Why a referral is not shown on a relationship row/,
    'and the page must say why the join is absent');

  // The book must not invent a last-touch column: the store has no such field.
  assert.doesNotMatch(rel, /last_interaction_at|last_touch|going cold['"]/i);
  assert.match(rel, /No last touch, and therefore no/);
});

test('reading referrals is pointless if the page that writes them is shut', () => {
  // Network · Relationships reads `referral_submissions`, and the only surface
  // that creates one is /referrals — which guarded every signed-in licence
  // EXCEPT advisor, though ReferralsPage has no role branch and every endpoint
  // it calls is requireAuth + scoped to referrer_user_id.
  const line = app.split('\n').find((l) => l.includes('path="/referrals"'));
  assert.ok(line, '/referrals must still be a route');
  assert.match(line, /'advisor'/, 'an advisor must be able to reach the page whose rows they read');
  const page = read('frontend/src/pages/ReferralsPage.jsx');
  assert.doesNotMatch(codeOnly(page), /role === '(admin|founder|partner|investor)'/,
    'if this page ever grows a role branch, opening it to advisors needs rethinking');
});

test('Signals is given both who you are and which workspace you are in', () => {
  // `user` was never passed on /research/*, so `mode` fell to founder for every
  // role: no advisor ordering, no advisor strip, no advisor_note — a field the
  // engine returns already. `isAdmin` was false for admins on the same route.
  // The rule is that BOTH reach the page, not that the mount has exactly three
  // props: it grew a fourth (the zone header's action row) and this assertion
  // failed on correct code. Bounded to the mount's own tag so a `user` three
  // components away cannot vouch for it.
  const mount = codeOnly(research).match(/<SignalsPage\b[\s\S]*?\/>/);
  assert.ok(mount, 'the Research workspace no longer mounts SignalsPage');
  assert.match(mount[0], /user=\{user\}/, 'the Research workspace must pass the user');
  assert.match(mount[0], /mode=\{/, 'the Research workspace must pass the mode');
  assert.match(mount[0], /\bembedded\b/, 'Signals must be told the shell owns the chrome');
  for (const line of app.split('\n').filter((l) => l.includes('<SignalsPage'))) {
    assert.match(line, /user=\{user\}/, `SignalsPage mounted without a user: ${line.trim()}`);
  }
  for (const line of app.split('\n').filter((l) => l.includes('<ResearchWorkspace'))) {
    assert.match(line, /user=\{user\}/, `ResearchWorkspace mounted without a user: ${line.trim()}`);
  }

  // `mode` is explicit rather than re-derived, because an admin previewing the
  // Advisor role has `user.role === 'admin'` and would otherwise get an advisor
  // shell wrapped around a body that ordered itself for a founder.
  const sig = codeOnly(read('frontend/src/pages/SignalsPage.jsx'));
  // Destructured props, not an exact signature: this page took a fourth (the
  // zone header's action row, passed only from `/research/markets`) and the
  // exact-spelling version failed on correct code.
  assert.match(sig, /function SignalsPage\(\{[^}]*\buser\b[^}]*\bembedded = false\b[^}]*\bmode: modeProp = null\b[^}]*\}\)/);
  assert.match(sig, /const mode = modeProp/);
  // The debug line that logged the signed-in user's role to the browser console
  // on every render is gone and must not come back.
  assert.doesNotMatch(sig, /console\.log/);
});

/**
 * Every `<X embedded …>` or `<X chromeless …>` mounted BY A WORKSPACE SHELL,
 * paired with X's file and the prop name it was handed.
 *
 * The scan is deliberately limited to `frontend/src/workspaces/`. Those are the
 * components that draw the breadcrumb, the h1, the zone pills and the rail, so
 * a child there that drops `embedded` provably renders a second set inside the
 * first — which is the defect, and it is what SignalsPage and
 * CompetitorAnalysisPage each did.
 *
 * Widening it to the whole SPA was tried and reports ten more mounts —
 * `AdvisorAdvisoryWorkspace` passing `embedded` to its five tab pages, and
 * `PartnerOperationsWorkspace` to its five. Those are NOT the same thing:
 * every one of those ten draws no shell, no h1 and no rail, so the prop is
 * inert rather than dropped. Failing them would be flagging a tidiness issue
 * with the wording of a correctness one.
 */
function embeddedMounts() {
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.jsx')) files.push(p);
    }
  }(resolve(root, 'frontend/src/workspaces')));

  const out = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    // Both layout props, because they are the same class of mistake: a shell
    // says "I have drawn the chrome" and the child never listens. Scanning only
    // `embedded` missed CompetitorAnalysisPage the moment Companies switched to
    // `chromeless` — the guard silently stopped covering the file it was
    // written for, which is the failure mode a guard must not have.
    for (const m of src.matchAll(/<([A-Z][\w]*)((?:\s+[^>]*?)?)\s(embedded|chromeless)[\s/>=]/g)) {
      const name = m[1];
      const prop = m[3];
      // Same-file import, static or lazy, and only relative paths — a barrel or
      // a package re-export is not resolvable here and is skipped rather than
      // guessed at.
      const imp = src.match(new RegExp(`import\\s+${name}\\s+from\\s+'(\\.[^']+)'`))
        || src.match(new RegExp(`const\\s+${name}\\s*=\\s*lazy\\(\\(\\)\\s*=>\\s*import\\('(\\.[^']+)'\\)`));
      if (!imp) continue;
      for (const ext of ['', '.jsx', '.js', '/index.jsx', '/index.js']) {
        const target = resolve(dirname(file), imp[1] + ext);
        if (existsSync(target) && statSync(target).isFile()) {
          out.push({ from: file, name, target, prop });
          break;
        }
      }
    }
  }
  return out;
}

test('a component mounted with `embedded` actually takes an `embedded` prop', () => {
  // Two components failed this independently — SignalsPage destructured only
  // `{ user }`, CompetitorAnalysisPage destructured nothing at all — and in
  // both cases the prop vanished silently and the page drew a second header
  // inside a shell that had already drawn one. React reports neither.
  const mounts = embeddedMounts();
  assert.ok(mounts.length >= 4,
    `only ${mounts.length} embedded mounts resolved — the scan is not seeing the shells`);

  const bad = [];
  for (const { from, name, target, prop } of mounts) {
    const body = codeOnly(readFileSync(target, 'utf8'));
    const takesIt = new RegExp(`\\b${prop}\\b`).test(body)
      // A component that forwards everything is fine — it cannot drop a prop.
      || /export default function \w+\(props\)/.test(body)
      || /\{\s*\.\.\.props\s*\}/.test(body);
    if (!takesIt) bad.push(`${name} is handed \`${prop}\` by ${from.replace(`${root}/`, '')} and never reads it`);
  }
  assert.deepEqual(bad, [], bad.join('; '));
});

test('the withdrawn Research tabs stay withdrawn, and the reason is written down', () => {
  // D9/D12 removed companies, AI research, news and documents because each
  // rendered a fixture with no API behind it, and set one condition for their
  // return: a licensed third-party source. Nothing here restores them.
  const code = codeOnly(research);
  assert.match(research, /D9 and\s*\n?\s*\* D12 withdrew|Decisions D9 and/,
    'the file must name the decision a reader would otherwise undo');
  // The distinction that keeps this honest: the advisor canvas asks for a
  // FIRST-PARTY surface, which D12's licensing condition does not govern.
  assert.match(research, /unbuilt, not forbidden/);

  // THE FIRST-PARTY HALF IS BUILT NOW, and this assertion flipped when it
  // shipped. It used to read `LIVE_ZONES = new Set(['markets', 'companies'])`
  // under a comment saying Ask and Library "still have no store and must still
  // say so" — true when written, false the moment migration 213 and
  // routes/research.ts landed. Updated to the new truth rather than loosened:
  // a card left standing in front of a working page is the failure this file's
  // sibling tests have caught three times.
  const live = code.slice(code.indexOf('const LIVE_ZONES'), code.indexOf('])', code.indexOf('const LIVE_ZONES')));
  assert.ok(live.length > 0 && live.length < 400, 'the LIVE_ZONES slice must not run away');
  for (const slug of ['library', 'ask']) {
    assert.ok(live.includes(`'${slug}'`), `${slug} has a store now and must be live`);
  }
  // And neither may still carry a no-store card.
  const copyStart = code.indexOf('const ZONE_COPY = {');
  const copyBlock = code.slice(copyStart, code.indexOf('\n};', copyStart));
  assert.ok(copyBlock.length > 0 && copyBlock.length < 4000, 'the ZONE_COPY slice must not run away');
  for (const slug of ['ask:', 'library:']) {
    assert.ok(!copyBlock.includes(slug),
      `${slug} still carries a "no store" card while its page reads a store`);
  }

  // WHAT D12 ACTUALLY GATED IS STILL GATED. The licensing condition governs
  // third-party research, and nothing here reaches for it: Ask answers only
  // from the caller's own uploads, and the rail says so.
  assert.match(research, /cannot search the web, company databases or market data/,
    'the third-party boundary D12 set must still be stated');
});

test('Companies says whose analyses it is showing', () => {
  const code = codeOnly(research);
  // `competitor_analyses` is keyed on user_id with no company column, so there
  // is no client to switch between — and no CompanySwitcher may appear here
  // implying otherwise.
  assert.match(code, /function CompanyScopeNote\(\{ role \}\)/);
  assert.match(research, /These analyses are yours, not a client/);
  assert.doesNotMatch(code, /CompanySwitcher/, 'this store has no company dimension to switch');
  // And the rail must not call it a live client book.
  assert.match(code, /Companies · your own analyses, not a client book/);
});

test('`chromeless` is not `embedded`, and the difference is load-bearing', () => {
  // `embedded` on CompetitorAnalysis means "locked to the startup I was handed":
  // it skips the project fetch and defaults the mode to `startup`. Forwarding it
  // from a workspace with no project would leave an advisor — whose project list
  // is empty by design — with a picker of nothing and no way back to custom.
  const comp = codeOnly(read('frontend/src/components/CompetitorAnalysis.jsx'));
  assert.match(comp, /chromeless = false/);
  assert.match(comp, /const bare = embedded \|\| chromeless;/);
  // The mode default and the project fetch stay on `embedded` alone.
  assert.match(comp, /useState\(embedded \? 'startup' : 'custom'\)/);
  assert.match(comp, /if \(embedded\) \{\s*\n\s*const list = await api\.competitors\.list\(\)/);
  // Same correction: what matters is which flag is asked for, not that it is
  // the only prop. `chromeless` present and `embedded` absent is the rule.
  const cmount = codeOnly(research).match(/<CompetitorAnalysisPage\b[\s\S]*?\/>/);
  assert.ok(cmount, 'Research no longer mounts the competitor analysis');
  assert.match(cmount[0], /\bchromeless\b/,
    'Research · Companies must ask for the layout flag, not the lock');
  assert.doesNotMatch(cmount[0], /\bembedded\b/,
    'Research · Companies must not lock the analysis to a startup it was not handed');
});
