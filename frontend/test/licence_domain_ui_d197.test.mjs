/**
 * D197 — the two screens a hostname store gives, and the one HQ does not get.
 *
 * H31 STATES THE TIER SPLIT AND IT IS WHAT MOST OF THIS FILE PINS: "There is
 * no Approve, no Add domain, and no DNS editor for HQ to complete on a
 * tenant's behalf." H26's own changelog says the same from the other end —
 * "An earlier draft made Domain an HQ console. It is not." So the wizard is
 * the tenant's, HQ gets a read-only strip plus Detach, and a control on the
 * wrong side of that line is this PR's one unsurvivable defect.
 *
 * AND THE SECOND SUBJECT IS WHAT `verified` IS NOT. Reaching *Active* needs a
 * Cloudflare for SaaS custom hostname on a zone this repository has no
 * groundwork for. So no screen may draw Active, and both must carry the
 * server's own sentence saying what is missing — a wizard that ends in a
 * pending state with no such sentence reads as an outage, when in fact S17's
 * rule means nobody is waiting on it at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const WIZARD = read('frontend/src/components/licence/DomainWizard.jsx');
const WIZARD_CODE = codeOnly(WIZARD);
const MINE = codeOnly(read('frontend/src/pages/subsidiary/MyLicencePage.jsx'));
const API = codeOnly(read('frontend/src/lib/api.js'));
const SERVICE = read('cloudflare-worker/src/services/licenceDomain.ts');

test('S17\'s load-bearing sentence is unconditional — a licence never waits on DNS', () => {
  // WITHOUT THIS, A PENDING WIZARD READS AS AN OUTAGE. Members are on the
  // platform host the deploy issued the whole time, so nothing on this screen
  // is holding anybody up; a tenant who does not know that will chase it.
  assert.match(WIZARD_CODE, /data-testid="domain-never-waits"/,
    'the wizard stopped saying that members are not waiting on this');
  const at = WIZARD_CODE.indexOf('data-testid="domain-never-waits"');
  const line = WIZARD_CODE.slice(at, WIZARD_CODE.indexOf('</p>', at));
  assert.match(line, /Members land on the platform host/);
  // It is OUTSIDE every conditional branch: rendered before the bind form,
  // before a bound host, and before the detached card.
  assert.ok(at < WIZARD_CODE.indexOf('{!domain &&'),
    'the sentence moved below a branch, so a tenant in one state stops seeing it');
});

test('no screen draws Active, and both carry the server\'s reason for why not', () => {
  // ACTIVE IS NAMED WITH THE CREDENTIAL IT NEEDS, NEVER CLAIMED. The sentence
  // is the server's (`SERVES_REASON`), so the wizard and HQ's strip cannot
  // word the same absence differently.
  assert.match(SERVICE, /export const SERVES_REASON/,
    'the reason stopped being one string both tiers read');
  assert.match(SERVICE, /serves: false/, 'the payload stopped saying a verified host does not serve');
  assert.match(WIZARD_CODE, /\{domain\.serves_reason\}/,
    'the wizard words the absence itself instead of rendering the server\'s sentence');
  // The word itself must not appear as a state the wizard can render.
  const states = [...WIZARD_CODE.matchAll(/domain\.state === '([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(!states.includes('active'),
    'the wizard branches on a state no row can hold and nothing can reach');
});

test('the wizard offers no Check and no Remove on a host Super Admin detached', () => {
  // Both writes answer 409 on a detached row, and a control that can only
  // refuse is the `still_an_admin` mistake D134 named. What the detached arm
  // offers instead is the reason HQ typed.
  const at = WIZARD_CODE.indexOf("domain.state === 'detached' ? (");
  assert.ok(at > 0, 'the detached state stopped being its own branch');
  const end = WIZARD_CODE.indexOf(') : (', at);
  assert.ok(end > at, 'the detached branch never closes');
  const detached = WIZARD_CODE.slice(at, end);
  assert.ok(!detached.includes('<button'),
    'the detached card grew a control, and both writes behind it answer 409');
  assert.match(detached, /\{domain\.detach_reason/, 'the detached card stopped showing HQ\'s reason');
  assert.match(detached, /Removing the record is Super Admin/,
    'the detached card stopped saying who can release the host');
});

test('an unreadable register is its own state, and never a form inviting a bind', () => {
  // #204's distinction on the surface it matters most: showing the bind form
  // when the register could not be read invites somebody to claim a host that
  // may already be bound.
  assert.match(WIZARD_CODE, /if \(available === false\) \{/,
    'the wizard stopped distinguishing an unreadable register from no host bound');
  const at = WIZARD_CODE.indexOf('if (available === false) {');
  const block = WIZARD_CODE.slice(at, WIZARD_CODE.indexOf('\n  }', at));
  assert.match(block, /data-testid="domain-unreadable"/);
  assert.ok(!block.includes('<input'), 'the unreadable state still offered a bind form');
});

test('the wizard renders the server\'s refusal sentence, never a generic one', () => {
  // Every refusal in `services/licenceDomain.ts` is written for somebody
  // standing in a registrar panel. Collapsing them into "Request failed" is
  // the whole thing that file exists not to do.
  assert.match(WIZARD_CODE, /e\?\.data\?\.error \|\| e\?\.message/,
    'the wizard stopped preferring the server\'s own sentence');
  assert.match(WIZARD_CODE, /data-testid="domain-error"/, 'a failed write renders nothing');
  // AND A FAILURE SAYS WHAT DID NOT HAPPEN. `finally` clearing a busy flag is
  // teardown, not an outcome — the defect D116 named on three Lab pages.
  assert.match(WIZARD_CODE, /nothing was changed/,
    'a failed write no longer says the host is unchanged');
});

test('an unreadable resolver is drawn differently from a record that is not published', () => {
  // `readable: false` is a fact about US; a missing record is a fact about the
  // tenant's zone. Drawing them alike sends somebody to a registrar panel to
  // fix a record that is fine.
  assert.match(WIZARD_CODE, /verdict\.ok\s*\?[\s\S]{0,200}verdict\.readable/,
    'the verdict renders two states where the server sends three');
  assert.match(WIZARD_CODE, /data-testid=\{`domain-verdict-\$\{verdict\.kind\}`\}/,
    'a verdict is no longer identified by which record it is about');
});

test('the wizard is mounted where the holder already is, and re-reads what it wrote', () => {
  assert.match(MINE, /import DomainWizard from '\.\.\/\.\.\/components\/licence\/DomainWizard'/,
    'the wizard is not mounted on the holder\'s own licence page');
  assert.match(MINE, /<DomainWizard/);
  // IT RE-READS RATHER THAN HOLDING A SECOND COPY. The three writes change a
  // field on this page's own payload, so handing back the loader is what stops
  // the strip and the page disagreeing — D128's tile-vs-table, one component
  // down.
  assert.match(MINE, /onChanged=\{loadLicence\}/, 'a write no longer re-reads the licence');
  assert.match(MINE, /domain=\{l\.domain \|\| null\}/);
  assert.match(MINE, /available=\{l\.domain_available\}/,
    'the page stopped passing whether the register was readable');
});

test('there is no read method — the host rides the licence payload, as kind does', () => {
  // D196's rule, applied again: a second fetch is a second thing that can
  // disagree with the first about the same row.
  const methods = [...API.matchAll(/^\s{2}(myDomain[A-Za-z]+|licenceDomain[A-Za-z]+):/gm)].map((m) => m[1]);
  assert.deepEqual(methods.sort(), ['licenceDomainDetach', 'myDomainBind', 'myDomainCheck', 'myDomainRemove'],
    'the domain api surface moved — a read method here would be the second source D196 refused');
  assert.match(API, /myDomainBind: \(hostname\) =>\s*\n?\s*request\('\/licence\/mine\/domain'/,
    'the bind stopped posting to the tenant router');
  // THE THREE TENANT WRITES ARE ON `/licence`, NOT `/admin`. That is what stops
  // the compliance freeze (D135) locking a holder out of their own settings.
  for (const m of ['myDomainBind', 'myDomainCheck', 'myDomainRemove']) {
    const at = API.indexOf(`${m}:`);
    const slice = API.slice(at, at + 220);
    assert.match(slice, /request\('\/licence\/mine\/domain/,
      `${m} moved off the tenant router and onto an admin one`);
  }
  const detachAt = API.indexOf('licenceDomainDetach:');
  assert.match(API.slice(detachAt, detachAt + 260), /\/admin\/licences\/\$\{encodeURIComponent\(uid\)\}\/domain\/detach/,
    'the detach moved off the admin router');
});
