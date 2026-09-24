/**
 * The topology, stated once on each tier (D209 — canvases H14 and S14).
 *
 * WHY A SERVICE AND NOT A PAGE CONSTANT. H14 and S14 state an architecture
 * rather than read a store, so their whole risk is saying something untrue —
 * and the canvases, measured against the code, did: most of what they drew
 * about the RPC surface, the shared services and who deploys what was false
 * (D209 carries the table). Two kinds of fact appear here, and they are kept
 * apart on purpose:
 *
 *   - STRUCTURAL facts the source decides: which bindings a Worker declares
 *     and what each names, which methods each RPC entrypoint declares and
 *     whether anything calls them, which workflows deploy what, which screens
 *     write Worker secrets, where Cloudflare Access is mounted. These are
 *     literals below, and `cloudflare-worker/test/topology_d209.test.ts` holds
 *     every one against the file that decides it — `wrangler.toml`,
 *     `rpc/index.ts` (through `scripts/lib/rpcSurface.mjs`),
 *     `scripts/lib/branchConfig.mjs`, `.github/workflows/`, `index.ts`. A
 *     literal that drifts fails a test rather than misleading a reader.
 *   - RUNTIME facts only this Worker can know: whether each binding is really
 *     present, which `BRANCH_*` bindings exist, whether the Analytics Engine
 *     SQL credentials are set, whether a deploy can be dispatched. These are
 *     read from `env` on every request and never written down.
 *
 * WHAT THIS IS NOT. It is not health — Platform → Deployments reads that over
 * each branch's binding — and it is not the registry, which is
 * `licence_deployments`. The HQ page composes both with this.
 *
 * NEVER A SECRET VALUE. Every credential is reduced to a boolean or to the
 * name of a script, here, before anything leaves the Worker.
 */
import type { Env } from '../types';
import { branchOf } from '../util/branch';
import { branchBindings } from './branches';
import { aeDataset, aeReadable } from './analyticsReports';
import { GATEWAY_TASKS, advisorGatewaySlug } from './aiRouter';
import { githubConfigured } from './githubSync';
import { secretWriteTarget } from './cloudflareSecrets';

/** HQ's script name — `[env.production] name` in wrangler.toml. */
export const HQ_WORKER = 'studioos';

/** The tail consumer both HQ's config and every generated branch config declare. */
export const TAIL_CONSUMER = 'studioos-tail';

// ── the bindings a Worker declares ──────────────────────────────────────────

export type BindingSpec = {
  name: string;
  kind: string;
  /** What `[env.production]` names; null where the config names an id, not a name. */
  hq: string | null;
  /** The name a branch's generated config gives it, for a code. */
  branch: (code: string) => string | null;
  /** One resource every Worker in the account shares, by design. */
  shared: boolean;
};

/**
 * The branch rule, spelt once. `branch-provision.yml` creates resources under
 * these names and `scripts/lib/branchConfig.mjs`'s `derivedNames` writes them
 * into the generated config; the test holds this function equal to that one
 * for several codes, because a Worker cannot import a script.
 */
export function branchResourceNames(code: string) {
  return {
    worker: `studioos-${code}`,
    hostname: `${code}.axal.vc`,
    d1: `studioos-${code}`,
    queue: `studioos-${code}-job-queue`,
    dlq: `studioos-${code}-job-queue-dlq`,
    r2: {
      FILES: `studioos-${code}-files`,
      PUBLICATIONS: `studioos-${code}-publications`,
      BACKUPS: `studioos-${code}-backups`,
    },
    vectorize: `axal-search-${code}`,
  };
}

/**
 * Every binding `[env.production]` declares, in the order the page lists
 * them. The test fails when wrangler.toml gains a binding this list lacks, or
 * names a resource differently.
 */
export const BINDINGS: readonly BindingSpec[] = [
  { name: 'DB', kind: 'D1 database', hq: 'studioos-db', branch: (c) => branchResourceNames(c).d1, shared: false },
  { name: 'TOKENS', kind: 'KV namespace', hq: null, branch: () => null, shared: false },
  { name: 'RATE_LIMITS', kind: 'KV namespace', hq: null, branch: () => null, shared: false },
  { name: 'FILES', kind: 'R2 bucket', hq: 'studioos-files', branch: (c) => branchResourceNames(c).r2.FILES, shared: false },
  { name: 'PUBLICATIONS', kind: 'R2 bucket', hq: 'studioos-publications', branch: (c) => branchResourceNames(c).r2.PUBLICATIONS, shared: false },
  { name: 'BACKUPS', kind: 'R2 bucket', hq: 'studioos-backups', branch: (c) => branchResourceNames(c).r2.BACKUPS, shared: false },
  { name: 'JOB_QUEUE', kind: 'Queue', hq: 'studioos-job-queue', branch: (c) => branchResourceNames(c).queue, shared: false },
  { name: 'PIPELINE_ROOM', kind: 'Durable Object namespace', hq: 'PipelineRoom', branch: () => 'PipelineRoom', shared: false },
  { name: 'ONBOARDING_CHAT', kind: 'Durable Object namespace', hq: 'OnboardingChat', branch: () => 'OnboardingChat', shared: false },
  { name: 'VECTORIZE', kind: 'Vectorize index', hq: 'axal-search', branch: (c) => branchResourceNames(c).vectorize, shared: false },
  { name: 'ANALYTICS', kind: 'Analytics Engine dataset', hq: 'studioos_metrics', branch: () => 'studioos_metrics', shared: true },
  { name: 'AI', kind: 'Workers AI', hq: null, branch: () => null, shared: true },
  { name: 'BROWSER', kind: 'Browser Rendering', hq: null, branch: () => null, shared: true },
  { name: 'ASSETS', kind: 'Static assets', hq: './docs', branch: () => './docs', shared: false },
];

// ── the RPC surface ─────────────────────────────────────────────────────────

export type RpcMethod = { name: string; called: boolean; authenticated: boolean };
export type RpcSide = {
  class: string;
  exported_by: 'hq' | 'branch';
  called_over: string;
  methods: RpcMethod[];
};

const m = (name: string, called: boolean, authenticated = false): RpcMethod => ({ name, called, authenticated });

/**
 * Both entrypoint classes, method for method, in declaration order.
 *
 * `called` is whether anything in the Worker calls the method ACROSS THE TIER
 * BOUNDARY; `authenticated` is whether it takes a secret. Both are derived in
 * the test from the source — the class's own parameter lists, and the D207
 * harvest of every `fanOut`, `branchRead`, `.stub.` and `HQ` call — so a
 * method gaining its first caller, or losing its last, fails the test until
 * this list says so. Four are declared and uncalled today (task #354; the
 * licence pull is #342).
 */
export const RPC_SURFACE: { hqCallsBranch: RpcSide; branchCallsHq: RpcSide } = {
  hqCallsBranch: {
    class: 'HqEntrypoint',
    exported_by: 'branch',
    called_over: 'BRANCH_<CODE>',
    methods: [
      m('health', true),
      m('overview', true),
      m('searchAccounts', true),
      m('applyLicence', true),
      m('revenueSummary', false),
      m('applyPromoCeiling', true),
      m('applyEscalationAnswer', true),
      m('publishTemplate', true),
      m('applyBenchmarks', true),
      m('openSupportSession', true, true),
      m('moveAccountOut', true, true),
      m('inviteAccount', true, true),
    ],
  },
  branchCallsHq: {
    class: 'BranchEntrypoint',
    exported_by: 'hq',
    called_over: 'HQ',
    methods: [
      m('escalate', true),
      m('licence', false),
      m('reportUsage', false, true),
      m('promoCeiling', false),
    ],
  },
};

// ── Analytics Engine ────────────────────────────────────────────────────────

/** What reads the shared dataset — every `aeSql` call site, by the surface it feeds. */
export const AE_READERS = [
  'HQ · Analytics · Technical — the platform-wide request log, not split by branch',
  'HQ · Monitoring · traffic by branch — super admin only (D161)',
  'HQ · Platform · Deployments — HQ\'s own acts against each branch over thirty days (D163)',
  'HQ · Analytics — signed-in accounts per branch per week, as counts; super admin only (D210)',
] as const;

/**
 * Figures a reader might expect to come from the shared dataset, and do not.
 * The canvas drew all three as Analytics Engine reads; each is something else.
 */
export const NOT_FROM_ANALYTICS = [
  'The benchmark median a branch receives. HQ computes it from each branch\'s overview() over its '
    + 'binding (D148), and a branch that does not answer is left out of the count rather than read '
    + 'from here.',
  'Guardrail counts. HQ reads them from its own database — the turn audit and the usage log — and '
    + 'they are platform-wide, not per branch.',
  'Statements. They are built from what a branch reports over reportUsage, which nothing calls yet.',
] as const;

// ── deploys, secrets and access ─────────────────────────────────────────────

/** Every workflow that runs `wrangler deploy`, and what each one deploys. */
export const DEPLOY_WORKFLOWS = [
  {
    file: 'cloudflare-worker-deploy.yml',
    trigger: 'on every push to main, or by hand',
    deploys: 'HQ, the studioos Worker, after its D1 migrations are applied',
  },
  {
    file: 'branch-provision.yml',
    trigger: 'by hand, or when HQ\'s Deploy step dispatches it',
    deploys: 'one new branch; it refuses a code that is already provisioned',
  },
  {
    file: 'pr-preview.yml',
    trigger: 'on each pull request',
    deploys: 'a preview Worker per pull request, serving the SPA with no bindings',
  },
] as const;

/**
 * The one workflow that deploys a branch — the only one whose `wrangler deploy`
 * reads a generated `wrangler.branch.<code>.toml`. It runs once per code. The
 * test holds this name to that deploy line, so S14 can say who deployed it
 * without typing the file name into the page.
 */
export const BRANCH_DEPLOYED_BY = 'branch-provision.yml';

/**
 * THE CANVAS SAID "GITHUB ACTIONS IS THE ONLY THING THAT DEPLOYS". It is not:
 * the root `npm run deploy` deploys HQ from a checkout, running its pending
 * migrations first through the `predeploy` hook (CLAUDE.md, fact 1). The test
 * holds this sentence to the root package.json's two scripts.
 */
export const DEPLOY_BY_HAND =
  'From a checkout, the root npm run deploy applies HQ\'s pending migrations and then deploys HQ, '
  + 'as the push-to-main job does. Nothing deploys a branch by hand.';

/**
 * THE CANVAS SAID "NO SCREEN WRITES TO CLOUDFLARE DIRECTLY". Three do: each
 * writes Worker secrets through the Cloudflare API, onto this Worker's own
 * script. None deploys code. The test holds this list to every `setSecret`
 * caller under routes/.
 */
export const SECRET_WRITERS = [
  { screen: 'Integration keys', writes: 'a provider\'s OAuth client id and secret' },
  { screen: 'GitHub Sync', writes: 'the repository token, its owner and name, and the webhook secret' },
  { screen: 'Stripe', writes: 'the webhook signing secret' },
] as const;

/**
 * THE CANVAS SAID ACCESS GUARDS /hq AND /admin/*. It guards these two routes
 * and nothing else; `index.ts` records why it was taken off /api/admin/*. The
 * test holds this list to every `requireCfAccess()` mount.
 */
export const CF_ACCESS_PATHS = [
  '/api/kyc/admin/:userId/document',
  '/api/kyc/admin/:userId/document/*',
] as const;

// ── the payload ─────────────────────────────────────────────────────────────

export type Topology = ReturnType<typeof describeTopology>;

/**
 * This Worker's topology. Pure over `env`: no D1 read, no network, so it
 * cannot fail on a store and needs no unreadable state of its own.
 */
export function describeTopology(env: Env) {
  const code = branchOf(env);
  const tier: 'hq' | 'branch' = code ? 'branch' : 'hq';
  const bag = env as unknown as Record<string, unknown>;
  const present = (name: string) => bag[name] != null;

  const bindings = BINDINGS.map((b) => ({
    name: b.name,
    kind: b.kind,
    resource: code ? b.branch(code) : b.hq,
    shared: b.shared,
    present: present(b.name),
  }));

  // HQ binds one line per provisioned branch; a branch should bind none.
  // Either way this is read, not assumed: a binding added by hand under the
  // BRANCH_ prefix shows up here, on the tier where it would be wrong.
  const branchLinks = branchBindings(env).map((b) => ({ code: b.code, binding: b.binding }));

  const readable = aeReadable(env);
  const target = secretWriteTarget(env);

  const base = {
    tier,
    code,
    worker: code ? branchResourceNames(code).worker : HQ_WORKER,
    bindings,
    rpc: {
      exports: tier === 'hq' ? RPC_SURFACE.branchCallsHq : RPC_SURFACE.hqCallsBranch,
      calls: tier === 'hq' ? RPC_SURFACE.hqCallsBranch : RPC_SURFACE.branchCallsHq,
    },
    analytics: {
      dataset: aeDataset(env),
      bound: present('ANALYTICS'),
      readable_here: readable,  // false on branch deployments (D230); they share the dataset but only HQ reads
      written_here: [
        'One point per metered API request — path, method, role, status and tier — with the writing '
          + 'Worker\'s branch code, or hq, in the sixth blob. It is carried per row, not as an index '
          + '(D161).',
        ...(tier === 'hq'
          ? ['One point per HQ act against a branch — the branch-action mirror (D163).']
          : []),
      ],
      read_by: [...AE_READERS],
      not_from_here: [...NOT_FROM_ANALYTICS],
    },
    ai_gateway: {
      // Labels, not task ids: the ids are code, and the product's voice is Eadwyn's.
      routes: GATEWAY_TASKS.map((id) => ({
        id,
        label: id === 'advisor_turn' ? 'Eadwyn\'s turns' : 'Eadwyn\'s explanations',
      })),
      slug_set: advisorGatewaySlug(env) !== null,
      carries_metadata: false,
    },
    tail: { consumer: TAIL_CONSUMER },
    deploys: {
      workflows: DEPLOY_WORKFLOWS.map((w) => ({ ...w })),
      by_hand: DEPLOY_BY_HAND,
      branch_deployed_by: BRANCH_DEPLOYED_BY,
      // No workflow deploys a branch a second time: provisioning refuses a
      // code it already holds, and the push-to-main job ships HQ alone. So a
      // branch runs the code it was provisioned with (task #356).
      branch_redeployed: false,
    },
    secret_writes: {
      screens: SECRET_WRITERS.map((s) => ({ ...s })),
      // The script a write would land on, or null when this Worker holds no
      // Cloudflare API token to write with. Never the token.
      target,
    },
  };

  if (tier === 'hq') {
    return {
      ...base,
      links: { hq: null, branches: branchLinks },
      // THE RULE, NOT A GUESS PER BRANCH. What a branch's resources are called
      // follows from its code; the registry carries the worker and database
      // names, and this carries the rest once, with <code> standing in.
      branch_naming: branchResourceNames('<code>'),
      access: { paths: [...CF_ACCESS_PATHS] },
      deploy_dispatch: { available: githubConfigured(env) },
    };
  }

  // THE BRANCH'S "CANNOT" LIST IS READ, NOT RECITED. S14 drew three refusals
  // as facts; two of them depend on what this Worker was given, so each is
  // checked here and says which way it came out.
  const hqBound = present('HQ');
  return {
    ...base,
    // Structural, not read: the registry refuses a hostname that is not
    // `<code>.axal.vc`, and the boot assertion refuses an APP_URL on any other
    // host (D106), so a branch that answers at all answers here.
    hostname: branchResourceNames(code as string).hostname,
    links: {
      hq: { bound: hqBound, service: HQ_WORKER, entrypoint: RPC_SURFACE.branchCallsHq.class },
      branches: branchLinks,
    },
    access: null,
    deploy_dispatch: { available: false },
    cannot: [
      {
        what: 'Reach another branch',
        holds: branchLinks.length === 0,
        why: branchLinks.length === 0
          ? 'Its one service binding is to HQ. The generator never copies a services table into a '
            + 'branch\'s config (D207), and no BRANCH_ binding is present on this Worker now.'
          : `This Worker holds a binding to ${branchLinks.map((b) => b.code).join(', ')}, which a `
            + 'generated branch config never writes. It was added by hand.',
      },
      {
        what: 'Read Analytics Engine',
        holds: !readable,
        why: !readable
          ? 'Its SQL API credentials are not set here. It writes to the shared dataset through its '
            + 'binding and cannot read it back.'
          : 'The SQL API credentials are set on this Worker, so it can read every branch\'s rows in '
            + 'the shared dataset. Nothing structural stops that yet.',
      },
      {
        what: 'Deploy anything, itself included',
        holds: true,
        why: 'The one route that dispatches a deploy is HQ-only, whatever secrets this Worker holds '
          + '(D106).',
      },
    ],
  };
}
