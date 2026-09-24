/**
 * D209 — HQ's Topology page (H14) and a branch's "This deployment" zone (S14),
 * rendered from what the Worker actually says.
 *
 * WHY THE FIXTURES COME FROM THE WORKER. Both surfaces state an architecture,
 * and `cloudflare-worker/test/topology_d209.test.ts` holds every fact in
 * `services/topology.ts` to the file that decides it. A hand-written payload
 * here would be a second copy of those facts, free to drift from the first, so
 * every payload below is `describeTopology(env)` run on an HQ-shaped or a
 * branch-shaped env. What this file adds is what only a render can see: that
 * each surface draws what it was given, says which way a runtime fact came
 * out, and never draws a state it could not have measured as a different one.
 *
 * What it pins:
 *  - RpcSide draws a class's methods in declaration order, a dashed chip for
 *    each one nothing calls, "· secret" on each that takes one, and names the
 *    uncalled ones in a sentence — a dashed chip is idle, never failed.
 *  - HQ's page: the deploy strip, HQ's own bindings and which are missing, the
 *    two Access paths, the three secret writers, the shared services, and a
 *    rail coverage that counts what was read.
 *  - A branch box has three binding states — bound, not bound, and unknown —
 *    and a fourth while the topology is still loading. None of them is drawn
 *    as another.
 *  - S14's summary, analytics heading and cannot-list are read from the
 *    payload, so a hand-added binding or a pair of SQL credentials changes
 *    what the zone says.
 *  - Neither surface uses a word the product does not.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';

import {
  DeploysStrip, HqWorkerCard, BranchBoxes, SharedCard, topologyCoverage, UNAVAILABLE,
} from '../src/pages/hq/PlatformTopologyPage.jsx';
import { DeploymentZone } from '../src/pages/branch/BranchSettings.jsx';
import { RpcSide } from '../src/components/TopologyParts.jsx';
import {
  describeTopology, BINDINGS, RPC_SURFACE, AE_READERS, DEPLOY_WORKFLOWS, DEPLOY_BY_HAND, CF_ACCESS_PATHS,
  SECRET_WRITERS, NOT_FROM_ANALYTICS, BRANCH_DEPLOYED_BY, BRANCH_PROVISIONED_BY,
} from '../../cloudflare-worker/src/services/topology.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

const html = (el, props) => renderToStaticMarkup(createElement(el, props));
/**
 * Rendered text with the two angle-bracket entities decoded too. The shared
 * helper decodes only what its own suites read; this payload says `<code>` and
 * `BRANCH_<CODE>`, which React escapes. Decoded after the tag scan, so no
 * decoded `<` can be mistaken for a tag.
 */
const readable = (markup) => renderedText(markup).replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const text = (el, props) => readable(html(el, props));

/** Every binding the configs declare, present — the Worker as deployed. */
const ALL_BOUND = Object.fromEntries(BINDINGS.map((b) => [b.name, {}]));
const AE_CREDS = { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_AE_API_TOKEN: 'ae' };

const HQ = describeTopology({ ...ALL_BOUND });
const BRANCH = describeTopology({ ...ALL_BOUND, BRANCH_CODE: 'fr', HQ: {} });

const OWN = BINDINGS.filter((b) => !b.shared);
const OFF_VOICE = /\badvi[cs]\w*|\brecommend\w*|\bfiduciar\w*/i;

/** Every `data-testid="rpc-method-*"` chip, in document order, with whether it is dashed. */
function chips(markup) {
  return [...markup.matchAll(/<span data-testid="rpc-method-([A-Za-z]+)" class="([^"]*)">([^<]*(?:<!-- -->[^<]*)*)<\/span>/g)]
    .map(([, name, cls, inner]) => ({ name, dashed: /\bborder-dashed\b/.test(cls), label: renderedText(inner) }));
}

/**
 * The element carrying `data-testid="<id>"`, as rendered text. Bounded by its
 * own closing tag: tags of the same name are counted open and shut, and a
 * self-closing one counts neither way.
 *
 * A LITERAL SCAN, NOT A PATTERN BUILT FROM THE TAG NAME. Every `<` in React's
 * static markup opens a tag or a comment — text and attribute values escape
 * theirs — so the scan steps from `<` to `<` and compares the name as text.
 * Measured against the regex it replaced, over every call this suite makes:
 * the same 48 results, and a scanner made blind to nesting on purpose
 * disagreed on three elements, so the comparison was live.
 */
function byTestId(markup, id) {
  const at = markup.indexOf(`data-testid="${id}"`);
  assert.ok(at >= 0, `${id} is not rendered`);
  const open = markup.lastIndexOf('<', at);
  const tag = /^<([a-z0-9]+)/.exec(markup.slice(open))[1];
  let depth = 0;
  for (let i = open; i >= 0; i = markup.indexOf('<', i + 1)) {
    const closing = markup[i + 1] === '/';
    const nameAt = i + (closing ? 2 : 1);
    if (!markup.startsWith(tag, nameAt) || /\w/.test(markup[nameAt + tag.length] ?? '')) continue;
    const end = markup.indexOf('>', nameAt);
    if (end < 0) break;
    if (markup[end - 1] === '/') continue;
    depth += closing ? -1 : 1;
    if (depth === 0) return readable(markup.slice(open, end + 1));
  }
  throw new Error(`${id} never closes`);
}

/**
 * Literal-text assertions. A count or a list of method names spliced into a
 * RegExp is a pattern built from data; comparing the text as text says the
 * same thing and shows both strings when it fails.
 */
function startsWithText(actual, expected) {
  assert.ok(actual.startsWith(expected), `expected ${JSON.stringify(actual)} to start with ${JSON.stringify(expected)}`);
}
function hasText(actual, expected) {
  assert.ok(actual.includes(expected), `expected ${JSON.stringify(expected)} in ${JSON.stringify(actual)}`);
}

// ── 1 · one render of the RPC surface ───────────────────────────────────────

for (const role of ['hqCallsBranch', 'branchCallsHq']) {
  test(`RpcSide draws ${RPC_SURFACE[role].class} method for method, dashing the ones nothing calls`, () => {
    const side = RPC_SURFACE[role];
    const markup = html(RpcSide, { side, heading: 'Heading', exportedBy: 'somebody' });
    const drawn = chips(markup);
    assert.deepEqual(drawn.map((c) => c.name), side.methods.map((m) => m.name), 'every method, in declaration order');
    for (const m of side.methods) {
      const c = drawn.find((x) => x.name === m.name);
      assert.equal(c.dashed, !m.called, `${m.name}: dashed exactly when nothing calls it`);
      assert.equal(c.label.endsWith(' · secret'), m.authenticated, `${m.name}: "· secret" exactly when it takes one`);
    }
    const uncalled = side.methods.filter((m) => !m.called).map((m) => m.name);
    assert.ok(uncalled.length > 0, 'both classes have an uncalled method today (task #354), or this proves nothing');
    const sentence = byTestId(markup, `rpc-uncalled-${side.class}`);
    startsWithText(sentence, `Declared and not called by anything yet: ${uncalled.join(', ')}.`);
    assert.match(sentence, /not one that failed/);
    assert.ok(readable(markup).includes(`${side.class}, exported by somebody and called over ${side.called_over}.`),
      'the class, who exports it and the binding it is called over');
  });
}

test('RpcSide says nothing about idle methods when every method is called', () => {
  const side = { ...RPC_SURFACE.hqCallsBranch, methods: RPC_SURFACE.hqCallsBranch.methods.map((m) => ({ ...m, called: true })) };
  const markup = html(RpcSide, { side, heading: 'H', exportedBy: 'x' });
  assert.equal(chips(markup).filter((c) => c.dashed).length, 0);
  assert.doesNotMatch(markup, /rpc-uncalled-/);
});

// ── 2 · HQ's page ───────────────────────────────────────────────────────────

test('the deploy strip lists what the Worker lists, and the dispatch sentence follows the credential', () => {
  const markup = html(DeploysStrip, { deploys: HQ.deploys, dispatch: HQ.deploy_dispatch });
  const list = byTestId(markup, 'h14-deploys');
  let at = -1;
  for (const w of DEPLOY_WORKFLOWS) {
    const next = list.indexOf(w.file);
    assert.ok(next > at, `${w.file} is listed, in order`);
    at = next;
    assert.ok(list.includes(`Runs ${w.trigger}.`), `${w.file} says when it runs`);
  }
  assert.equal(byTestId(markup, 'h14-deploys-by-hand'), DEPLOY_BY_HAND);
  // D253: the payload says branches are redeployed, so the page says so, and
  // the old "nothing redeploys" warning is gone.
  assert.match(byTestId(markup, 'h14-branch-redeployed'), /^Every push to main redeploys each provisioning or live branch after HQ/);
  assert.doesNotMatch(markup, /h14-branch-not-redeployed/);
  // Nor may any other copy on the page still say it: D253 left the rail row
  // claiming no workflow redeploys a branch until the residue commit fixed it.
  // The rail rows are unconditional, unlike the `branch_redeployed === false`
  // note above, so they are read line by line, the way hq_home reads rails.
  const rail = readFileSync('frontend/src/pages/hq/PlatformTopologyPage.jsx', 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l.startsWith("['"));
  assert.ok(rail.length > 0, 'the page has rail rows to read');
  for (const row of rail) {
    assert.doesNotMatch(row, /(?:deploys a branch a second time|redeploys? (?:a|no) branch|nothing redeploys)/i,
      `a rail row still says branches are not redeployed: ${row.slice(0, 80)}`);
  }
  assert.match(byTestId(markup, 'h14-dispatch'), /^HQ cannot dispatch provisioning from here: the repository token, owner and name are not all set/);
  const dispatchable = describeTopology({ ...ALL_BOUND, GITHUB_ACCESS_TOKEN: 't', GITHUB_REPO_OWNER: 'o', GITHUB_REPO_NAME: 'n' });
  assert.match(text(DeploysStrip, { deploys: dispatchable.deploys, dispatch: dispatchable.deploy_dispatch }), /HQ can dispatch provisioning from a licence’s Deploy step\./);
  // The redeploy sentence is conditional on the payload, not typed in.
  const notRedeployed = html(DeploysStrip, { deploys: { ...HQ.deploys, branch_redeployed: false }, dispatch: HQ.deploy_dispatch });
  assert.match(notRedeployed, /h14-branch-not-redeployed/);
  assert.doesNotMatch(notRedeployed, /h14-branch-redeployed"/);
});

test('HQ\'s card: its own bindings and which are missing, both sides of the RPC surface, Access and the secret writers', () => {
  const full = html(HqWorkerCard, { topo: HQ });
  const tags = byTestId(full, 'h14-hq-bindings');
  for (const b of OWN) assert.ok(tags.includes(b.hq ? `${b.name} · ${b.hq}` : b.name), `${b.name} is drawn with its resource`);
  for (const b of BINDINGS.filter((x) => x.shared)) assert.ok(!tags.includes(b.name), `${b.name} is shared and belongs to the shared card`);
  hasText(renderedText(full), `All ${OWN.length} of its own bindings are present on this Worker.`);
  assert.match(full, /data-testid="rpc-side-HqEntrypoint"/);
  assert.match(full, /data-testid="rpc-side-BranchEntrypoint"/);
  const access = renderedText(full);
  hasText(byTestId(full, 'h14-access'), `Stands in front of ${CF_ACCESS_PATHS.length} routes and no others`);
  for (const p of CF_ACCESS_PATHS) assert.ok(access.includes(p), `Access path ${p} is listed`);
  const writers = byTestId(full, 'h14-secret-writers');
  for (const s of SECRET_WRITERS) assert.ok(writers.includes(`${s.screen} — ${s.writes}`));
  assert.match(byTestId(full, 'h14-secret-target'), /holds no Cloudflare API token/);
  const writable = describeTopology({ ...ALL_BOUND, CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' });
  assert.equal(byTestId(html(HqWorkerCard, { topo: writable }), 'h14-secret-target'), 'Each writes onto the studioos script. None deploys code.');

  // A binding that is declared and not present is drawn as such, by name.
  const partial = describeTopology({ DB: {}, ANALYTICS: {} });
  const note = renderedText(html(HqWorkerCard, { topo: partial }));
  assert.match(note, /Declared and not present on this Worker: TOKENS, RATE_LIMITS, FILES/);
  assert.doesNotMatch(note, /Declared and not present on this Worker:[^.]*\bDB\b/);
});

// ── 3 · a branch box, in every state it can be in ───────────────────────────

const deployment = (extra = {}) => ({
  code: 'fr', hostname: 'fr.axal.vc', worker_name: 'studioos-fr', d1_name: 'studioos-fr',
  d1_jurisdiction: 'eu', location_hint: null, live_state: 'ok', live: { db_ok: true }, live_reason: null, ...extra,
});
const boxes = (deps, links) => html(BranchBoxes, { deps, links, naming: HQ.branch_naming });

test('an empty registry says it is empty, and whether HQ binds none only when that was read', () => {
  assert.equal(byTestId(boxes({ deployments: [] }, []), 'h14-no-branches'),
    'No branch is provisioned and HQ binds none. This is an empty registry, not an unreadable one.');
  assert.equal(byTestId(boxes({ deployments: [] }, null), 'h14-no-branches'),
    'No branch is provisioned. This is an empty registry, not an unreadable one.');
});

test('a branch box says bound, not bound, unknown or still reading — four states, never merged', () => {
  const line = (links) => byTestId(boxes({ deployments: [deployment()] }, links), 'h14-branch-fr');
  assert.match(line([{ code: 'fr', binding: 'BRANCH_FR' }]), /HQ binds it as BRANCH_FR\./);
  assert.match(line([]), /HQ holds no binding to it yet, so HQ cannot read or push to it until the link PR/);
  assert.match(line(null), /Whether HQ binds it is unknown here: the topology could not be read\./);
  assert.match(line(undefined), /Reading whether HQ binds it…/);
  assert.doesNotMatch(line(undefined), /could not be read/, 'a read still in flight has not failed');
  assert.doesNotMatch(line(null), /holds no binding/, 'an unread topology is not an empty one');

  // …and the page is what maps its own three states onto those four. It loads
  // in an effect, so a render never gets past "still reading"; the mapping is
  // read off the one element that receives it. An unreadable topology handed
  // down as [] would be drawn as "HQ holds no binding" — a claim nothing
  // measured, which is the merge this test is named for.
  const page = codeOnly(read('frontend/src/pages/hq/PlatformTopologyPage.jsx'));
  const at = page.indexOf('<BranchBoxes');
  assert.ok(at > 0, 'the page draws the branch boxes');
  const el = page.slice(at, page.indexOf('/>', at));
  assert.match(el, /links=\{topoReady \? topo\.links\?\.branches \|\| \[\] : topo === null \? undefined : null\}/,
    'ready passes the list, still reading passes undefined, unreadable passes null — never []');
});

test('a binding the registry has no row for is its own box, and residency is read or stated absent', () => {
  const markup = boxes({ deployments: [deployment()] }, [{ code: 'fr', binding: 'BRANCH_FR' }, { code: 'de', binding: 'BRANCH_DE' }]);
  assert.match(byTestId(markup, 'h14-bound-only-de'), /BRANCH_DE.*HQ binds this code and the registry has no row for it/);
  assert.match(byTestId(markup, 'h14-branch-fr'), /EU resident/);
  assert.match(byTestId(boxes({ deployments: [deployment({ d1_jurisdiction: null, location_hint: 'weur' })] }, []), 'h14-branch-fr'),
    /hinted WEUR \(not guaranteed\)/);
  const unrecorded = boxes({ deployments: [deployment({ d1_jurisdiction: null, location_hint: null })] }, []);
  assert.match(byTestId(unrecorded, 'h14-branch-fr'), /Not recorded/);
  assert.match(unrecorded, /title="The registry row records neither a jurisdiction nor a location hint for this branch\."/);
});

test('the live pill is the one Platform → Deployments draws', () => {
  const pill = (d) => byTestId(boxes({ deployments: [d] }, []), 'h14-branch-fr');
  assert.match(pill(deployment()), /answering/);
  assert.match(pill(deployment({ live: { db_ok: false } })), /database failing/);
  assert.match(pill(deployment({ live_state: 'not_deployed', live_reason: 'No binding yet.' })), /no binding yet.*No binding yet\./);
});

test('the naming rule is the Worker\'s, drawn once with <code> standing in', () => {
  const n = byTestId(boxes({ deployments: [] }, []), 'h14-naming');
  for (const v of ['studioos-<code>', '<code>.axal.vc', 'studioos-<code>-job-queue', 'axal-search-<code>', ...Object.values(HQ.branch_naming.r2)]) {
    assert.ok(n.includes(v), `the naming line carries ${v}`);
  }
  assert.doesNotMatch(html(BranchBoxes, { deps: { deployments: [] }, links: [], naming: null }), /h14-naming/);
});

// ── 4 · what every Worker shares ────────────────────────────────────────────

test('the shared card: the dataset and who reads it, the gateway, the account services and the tail', () => {
  const markup = html(SharedCard, { topo: HQ });
  const analytics = byTestId(markup, 'h14-shared-analytics');
  assert.match(analytics, /Analytics Engine · studioos_metrics/);
  assert.match(analytics, /HQ writes one point per metered API request/);
  assert.match(analytics, /HQ writes one point per HQ act against a branch/);
  for (const r of AE_READERS) assert.ok(analytics.includes(r), `reader listed: ${r}`);
  assert.match(analytics, /cannot read the dataset: its SQL API credentials are not set here/);
  const notFrom = byTestId(markup, 'h14-not-from-analytics');
  for (const n of NOT_FROM_ANALYTICS) assert.ok(notFrom.includes(n));
  assert.match(byTestId(html(SharedCard, { topo: describeTopology({ ...ALL_BOUND, ...AE_CREDS }) }), 'h14-shared-analytics'),
    /holds the SQL API credentials, so it can read the dataset/);

  assert.match(byTestId(markup, 'h14-shared-gateway'), /No gateway is set on this Worker, so every model call goes to Workers AI directly\./);
  const slug = describeTopology({ ...ALL_BOUND, CF_AI_GATEWAY_SLUG_ADVISOR: 'g' });
  assert.match(byTestId(html(SharedCard, { topo: slug }), 'h14-shared-gateway'),
    /Routes Eadwyn's turns and Eadwyn's explanations through the gateway\. Every other model call goes to Workers AI directly\./);
  assert.match(byTestId(markup, 'h14-gateway-metadata'), /No call carries metadata naming a branch or a person/);

  assert.match(byTestId(markup, 'h14-shared-AI'), /Workers AI — bound as AI, one account-wide service\./);
  const unbound = html(SharedCard, { topo: describeTopology({ DB: {} }) });
  assert.match(byTestId(unbound, 'h14-shared-AI'), /Workers AI — declared as AI and not present on this Worker\./);
  assert.match(byTestId(markup, 'h14-shared-tail'), /Tail consumer · studioos-tail/);
});

test('the rail\'s coverage counts what the page read, one line per read, and nothing it did not', () => {
  const calls = RPC_SURFACE.hqCallsBranch.methods;
  assert.deepEqual(topologyCoverage(HQ, { deployments: [deployment(), deployment({ code: 'de' })] }), [
    `HQ: ${OWN.length} of ${OWN.length} own bindings present`,
    `${calls.length} methods HQ may call on a branch, ${calls.filter((m) => m.called).length} of them called`,
    '0 branch bindings on HQ',
    '2 branches in the registry',
  ]);
  assert.deepEqual(topologyCoverage(UNAVAILABLE, UNAVAILABLE), []);
  assert.deepEqual(topologyCoverage(null, { registry_available: false, deployments: [] }), []);
  assert.equal(topologyCoverage(describeTopology({ DB: {} }), null)[0], `HQ: 1 of ${OWN.length} own bindings present`);
});

// ── 5 · the branch's own view ───────────────────────────────────────────────

test('S14 names this Worker, its own resources, its one link and both sides of the surface', () => {
  const markup = html(DeploymentZone, { dep: BRANCH });
  assert.equal(byTestId(markup, 's14-identity'), 'fr.axal.vc · studioos-fr');
  const own = byTestId(markup, 's14-own');
  for (const b of OWN) {
    const r = b.branch('fr');
    assert.ok(own.includes(r ? `${b.name} · ${r}` : b.name), `${b.name} names the branch's own resource`);
  }
  startsWithText(byTestId(markup, 's14-own-note'), `All ${OWN.length} are present on this Worker`);
  assert.equal(byTestId(markup, 's14-hq-link'), 'Bound to HQ\'s studioos Worker, through BranchEntrypoint.');
  assert.match(markup, /data-testid="rpc-side-HqEntrypoint"/);
  assert.match(markup, /data-testid="rpc-side-BranchEntrypoint"/);
  assert.match(byTestId(markup, 's14-summary'), /It holds one service binding, to HQ, and exports one entrypoint HQ may call\./);
  assert.equal(byTestId(markup, 's14-analytics-head'), 'Writes to, cannot read');
  assert.match(renderedText(markup), /This branch writes one point per metered API request/);
  assert.doesNotMatch(renderedText(markup), /act against a branch/, 'a branch writes no mirror rows');
  assert.equal(byTestId(markup, 's14-redeployed'),
    `Redeployed after HQ on every push to main, by ${BRANCH_DEPLOYED_BY}, so this Worker runs main’s code. Provisioned by ${BRANCH_PROVISIONED_BY}.`);
  assert.doesNotMatch(markup, /s14-deployed-once/);
  assert.match(byTestId(markup, 's14-gateway'), /cannot be split by branch/);
});

test('S14\'s cannot-list, summary and heading say which way each came out on this Worker', () => {
  const holds = (dep) => [...html(DeploymentZone, { dep }).matchAll(/data-testid="s14-cannot" data-holds="(yes|no)"/g)].map((m) => m[1]);
  assert.deepEqual(holds(BRANCH), ['yes', 'yes', 'yes']);

  const handAdded = describeTopology({ ...ALL_BOUND, BRANCH_CODE: 'fr', HQ: {}, BRANCH_DE: {} });
  const handAddedMarkup = html(DeploymentZone, { dep: handAdded });
  assert.deepEqual(holds(handAdded), ['no', 'yes', 'yes']);
  assert.match(renderedText(handAddedMarkup), /Reach another branchdoes not hold here/);
  assert.match(handAddedMarkup, /bg-amber-100[^"]*">does not hold here</, 'a refusal that stopped holding is amber, never a tick');
  assert.match(byTestId(handAddedMarkup, 's14-summary'),
    /It holds a binding to HQ and one to another branch, which a generated config never writes, and exports/);

  const branchWithCreds = describeTopology({ ...ALL_BOUND, BRANCH_CODE: 'fr', HQ: {}, ...AE_CREDS });
  assert.deepEqual(holds(branchWithCreds), ['yes', 'yes', 'yes']);
  assert.equal(byTestId(html(DeploymentZone, { dep: branchWithCreds }), 's14-analytics-head'), 'Writes to, cannot read');

  const noHq = describeTopology({ ...ALL_BOUND, BRANCH_CODE: 'fr', HQ: undefined });
  const noHqMarkup = html(DeploymentZone, { dep: noHq });
  assert.equal(byTestId(noHqMarkup, 's14-hq-link'), 'No HQ binding is present on this Worker, so nothing this branch raises can reach HQ.');
  assert.match(byTestId(noHqMarkup, 's14-summary'), /It holds no binding to HQ, and exports/);
});

// ── 6 · voice, and the wiring ───────────────────────────────────────────────

test('neither surface uses a word the product does not', () => {
  const renders = [
    html(DeploysStrip, { deploys: HQ.deploys, dispatch: HQ.deploy_dispatch }),
    html(HqWorkerCard, { topo: HQ }),
    boxes({ deployments: [deployment()] }, [{ code: 'fr', binding: 'BRANCH_FR' }]),
    html(SharedCard, { topo: describeTopology({ ...ALL_BOUND, CF_AI_GATEWAY_SLUG_ADVISOR: 'g' }) }),
    html(DeploymentZone, { dep: BRANCH }),
  ];
  for (const r of renders) assert.doesNotMatch(renderedText(r), OFF_VOICE);
});

test('viewing as a branch does not narrow the topology page, and the page says so', () => {
  // H14 describes HQ's Worker and the registry of every branch, so the shell's
  // view-as state (D153) changes nothing on it — and a reader who arrived
  // viewing as one branch would otherwise take the page for that branch's. Read
  // off the source, because the note hangs on shell context a static render of
  // the page does not have.
  const page = codeOnly(read('frontend/src/pages/hq/PlatformTopologyPage.jsx'));
  assert.match(page, /const \{ branch: viewAs \} = useViewAsBranch\(\);/, "the page reads the shell's view-as state, not its own");
  const at = page.indexOf('{viewAs && (');
  assert.ok(at > 0, 'the note is drawn whenever a branch is being viewed as');
  const note = page.slice(at, page.indexOf(')}', at));
  assert.match(note, /data-testid="hq-topology-view-as"/);
  assert.match(note, /Viewing as \{viewAs\} does not narrow this page/);
});

test('the page is routed, linked, reads its two sources each with its own state, and types no topology fact', () => {
  const app = codeOnly(read('frontend/src/App.jsx'));
  assert.match(app, /const HqPlatformTopologyPage = lazy\(\(\) => import\('\.\/pages\/hq\/PlatformTopologyPage'\)\);/);
  assert.ok(app.includes('<Route path="/admin/platform/topology" element={guard([\'admin\'], hqOnly(<HqPlatformTopologyPage />))} />'),
    'HQ-only, admin-guarded, like every Platform page');
  // A literal <Link to> is what the reachability walk counts (D146).
  assert.match(codeOnly(read('frontend/src/pages/hq/PlatformPage.jsx')), /<Link\s+to="\/admin\/platform\/topology"/);

  const api = codeOnly(read('frontend/src/lib/api.js'));
  assert.ok(api.includes("hqPlatformTopology: () => request('/admin/platform/topology'),"));
  assert.ok(api.includes("branchDeployment: () => request('/branch/deployment'),"));

  const page = codeOnly(read('frontend/src/pages/hq/PlatformTopologyPage.jsx'));
  assert.match(page, /api\.hqPlatformTopology\(\)\.then\(setTopo, \(e\) => \{ reportError\('hq-platform-topology', e\); setTopo\(UNAVAILABLE\); \}\);/);
  assert.match(page, /api\.deployments\(\)\.then\(setDeps, \(e\) => \{ reportError\('hq-platform-topology:deployments', e\); setDeps\(UNAVAILABLE\); \}\);/);
  assert.match(page, /role="super_admin"/);
  // Everything a reader could check against the code comes off the payload.
  for (const fact of ['HqEntrypoint', 'BranchEntrypoint', 'studioos-tail', 'studioos_metrics', '/api/kyc', 'branch-provision.yml', 'axal-search']) {
    assert.ok(!page.includes(fact), `the HQ page types "${fact}"; it must come off the payload`);
  }

  const settings = codeOnly(read('frontend/src/pages/branch/BranchSettings.jsx'));
  assert.match(settings, /api\.branchDeployment\(\)\.then\(setDeployment, \(e\) => \{ reportError\('branch-settings:deployment', e\); setDeployment\(UNAVAILABLE\); \}\);/);
  assert.ok(settings.includes('<Unreadable what="This deployment\'s description" claim="This is not a claim that anything is unbound." onRetry={load} />'));
  assert.doesNotMatch(settings, /<WorkerRail\b/, 'the branch rail is BranchZone\'s, never a second one');
  const zone = settings.slice(settings.indexOf('export function DeploymentZone'), settings.indexOf('export default function BranchSettings'));
  for (const fact of ['HqEntrypoint', 'BranchEntrypoint', 'studioos_metrics', 'branch-provision.yml', 'axal-search']) {
    assert.ok(!zone.includes(fact), `S14 types "${fact}"; it must come off the payload`);
  }
});
