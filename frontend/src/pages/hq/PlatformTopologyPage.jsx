import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Network } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { liveChip, residencyLine } from '../../lib/deployTimeline';
import { useViewAsBranch } from '../../contexts/ViewAsBranchContext';
import { TopologyTag, RpcSide } from '../../components/TopologyParts';
import { Card, WorkerRail, Unrecorded, Unreadable } from '../../ui';

/**
 * HQ · Platform → Topology — what HQ can read, and through what (H14, D209).
 *
 * WHAT THIS PAGE IS, AND WHY ITS WHOLE RISK IS SAYING SOMETHING UNTRUE. It
 * states an architecture rather than reading a store. The canvas drew one, and
 * measured against the code most of it was false: Cloudflare Access on /hq and
 * every /admin route (it guards two KYC routes), "no screen writes to
 * Cloudflare" (three write Worker secrets), an entrypoint exporting five
 * methods of which four do not exist, a dataset indexed by branch (the code
 * rides in a blob), AI Gateway metadata on every call (D261 sends it on the two
 * gatewayed task classes only). D209 carries
 * the whole table. So nothing on this page is typed here: every fact comes
 * from `services/topology.ts` over `GET /api/admin/platform/topology`, and
 * `cloudflare-worker/test/topology_d209.test.ts` holds that service to the
 * files that decide each fact — wrangler.toml, the RPC classes, the workflows.
 *
 * TWO READS, TWO STATES. The topology is HQ's own Worker described from its
 * `env`, and cannot fail on a store. The branch boxes come from the registry
 * and the live health read Platform → Deployments already makes, which can.
 * One failing never empties the other: a registry that could not be read is
 * not evidence about HQ's bindings, and the reverse.
 *
 * REACHED FROM PLATFORM BY A LITERAL LINK, not a sidebar row — the HQ group is
 * eleven rows by design (D146), and this page is the Deployments zone's detail.
 */

export const UNAVAILABLE = Symbol('unavailable');

function SectionHead({ title, sub }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-[14px] font-extrabold tracking-tight">{title}</h2>
      {sub && <span className="text-[11px] text-axal-faint">{sub}</span>}
    </div>
  );
}

/**
 * Who deploys what. The canvas drew one line — "GitHub Actions is the only
 * thing that deploys" — and there are three workflows and a hand-run script,
 * and none of them deploys a branch a second time.
 */
export function DeploysStrip({ deploys, dispatch }) {
  const workflows = deploys?.workflows || [];
  return (
    <Card>
      <SectionHead title="Who deploys what" sub="the workflows that run wrangler deploy" />
      <ul className="space-y-2" data-testid="h14-deploys">
        {workflows.map((w) => (
          <li key={w.file} className="text-[12px] leading-relaxed">
            <span className="font-mono text-[11px] font-bold">{w.file}</span>
            <span className="text-axal-muted"> — {w.deploys}. </span>
            <span className="text-axal-faint">Runs {w.trigger}.</span>
          </li>
        ))}
      </ul>
      {deploys?.by_hand && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-axal-muted" data-testid="h14-deploys-by-hand">{deploys.by_hand}</p>
      )}
      {deploys?.branch_redeployed === true && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-axal-muted" data-testid="h14-branch-redeployed">
          Every push to main redeploys each provisioning or live branch after HQ, applying its own migrations
          first, so a branch runs main&rsquo;s code. One branch failing does not stop the others.
        </p>
      )}
      {deploys?.branch_redeployed === false && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-amber-800 dark:text-amber-300" data-testid="h14-branch-not-redeployed">
          Nothing deploys a branch a second time. Provisioning refuses a code it already holds, and the push to
          main ships HQ alone, so a branch runs the code it was provisioned with.
        </p>
      )}
      <p className="mt-2 text-[11px] text-axal-faint" data-testid="h14-dispatch">
        {dispatch?.available
          ? 'HQ can dispatch provisioning from a licence’s Deploy step.'
          : 'HQ cannot dispatch provisioning from here: the repository token, owner and name are not all set on this Worker. The workflow can still be run by hand from GitHub\u2019s Actions tab.'}
      </p>
    </Card>
  );
}

/**
 * HQ's own Worker: the bindings it declares, what it exports and calls, where
 * Cloudflare Access actually stands, and which screens write its secrets.
 */
export function HqWorkerCard({ topo }) {
  const own = (topo?.bindings || []).filter((b) => !b.shared);
  const missing = own.filter((b) => !b.present);
  return (
    <Card>
      <SectionHead title={`HQ worker · ${topo?.worker || ''}`} sub="its own records, never a branch's" />
      <div className="flex flex-wrap gap-1.5" data-testid="h14-hq-bindings">
        {own.map((b) => (
          <TopologyTag key={b.name} muted={!b.present}>
            {b.name}{b.resource ? ` · ${b.resource}` : ''}
          </TopologyTag>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-axal-faint">
        {missing.length === 0
          ? `All ${own.length} of its own bindings are present on this Worker.`
          : `Declared and not present on this Worker: ${missing.map((b) => b.name).join(', ')}.`}
      </p>

      <div className="mt-3 divide-y divide-axal-hairline border-t border-axal-hairline">
        <RpcSide side={topo?.rpc?.calls} heading="HQ reads and pushes to a branch" exportedBy="each branch" />
        <RpcSide side={topo?.rpc?.exports} heading="A branch calls HQ" exportedBy="HQ" />
      </div>

      <div className="mt-3 grid gap-3 border-t border-axal-hairline pt-3 sm:grid-cols-2">
        <div>
          <div className="text-[11.5px] font-bold">Cloudflare Access</div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-axal-muted" data-testid="h14-access">
            Stands in front of {(topo?.access?.paths || []).length} routes and no others:
          </p>
          <ul className="mt-1 space-y-0.5">
            {(topo?.access?.paths || []).map((p) => (
              <li key={p} className="font-mono text-[10.5px] text-axal-faint">{p}</li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] leading-relaxed text-axal-faint">
            Every other route is gated by the platform&rsquo;s own sign-in and role checks, not by Access.
          </p>
        </div>
        <div>
          <div className="text-[11.5px] font-bold">Screens that write Worker secrets</div>
          <ul className="mt-1 space-y-0.5" data-testid="h14-secret-writers">
            {(topo?.secret_writes?.screens || []).map((s) => (
              <li key={s.screen} className="text-[11px] leading-snug text-axal-muted">
                <b>{s.screen}</b> — {s.writes}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] leading-relaxed text-axal-faint" data-testid="h14-secret-target">
            {topo?.secret_writes?.target
              ? `Each writes onto the ${topo.secret_writes.target} script. None deploys code.`
              : 'This Worker holds no Cloudflare API token, so each of them answers that the write is not configured.'}
          </p>
        </div>
      </div>
    </Card>
  );
}

/**
 * One box per branch. The registry says what HQ provisioned; the bindings say
 * whether HQ can reach it; the live read says whether it answered a moment ago.
 * Three facts, three places, never merged into one.
 *
 * `links` HAS THREE STATES, and only one of them is a list. An array is what
 * HQ binds. `null` means the topology could not be read, and `undefined` that
 * it is still being read. Neither is an empty list: "HQ holds no binding to
 * it" would be a claim about HQ's config that nothing on this page measured,
 * and "could not be read" is untrue until the read has actually failed. So
 * each box says which of the two it is instead.
 */
export function BranchBoxes({ deps, links, naming }) {
  const rows = deps?.deployments || [];
  const linksKnown = Array.isArray(links);
  const bindingOf = new Map((linksKnown ? links : []).map((l) => [l.code, l.binding]));
  const registered = new Set(rows.map((d) => d.code));
  const boundOnly = (linksKnown ? links : []).filter((l) => !registered.has(l.code));

  return (
    <Card>
      <SectionHead title="Branches" sub="one Worker and one database each, reached over one binding" />
      {rows.length === 0 && boundOnly.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-axal-muted" data-testid="h14-no-branches">
          {linksKnown
            ? 'No branch is provisioned and HQ binds none. This is an empty registry, not an unreadable one.'
            : 'No branch is provisioned. This is an empty registry, not an unreadable one.'}
        </p>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2" data-testid="h14-branches">
          {rows.map((d) => (
            <div key={d.code} className="rounded-lg border border-axal-hairline p-3" data-testid={`h14-branch-${d.code}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[12px] font-bold">{d.hostname}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${liveChip(d)[1]}`}>
                  {liveChip(d)[0]}
                </span>
              </div>
              <div className="mt-0.5 font-mono text-[10.5px] text-axal-faint">
                {d.worker_name} · {d.d1_name}
              </div>
              <div className="mt-1 text-[11px] text-axal-muted">
                {residencyLine(d) || <Unrecorded reason="The registry row records neither a jurisdiction nor a location hint for this branch." />}
              </div>
              <p className="mt-1.5 text-[11px] leading-snug text-axal-muted">
                {links === undefined
                  ? 'Reading whether HQ binds it…'
                  : !linksKnown
                  ? 'Whether HQ binds it is unknown here: the topology could not be read.'
                  : bindingOf.has(d.code)
                    ? `HQ binds it as ${bindingOf.get(d.code)}.`
                    : 'HQ holds no binding to it yet, so HQ cannot read or push to it until the link PR for this code is merged and HQ redeploys.'}
              </p>
              {d.live_state !== 'ok' && d.live_reason && (
                <p className="mt-1 text-[11px] leading-snug text-axal-faint">{d.live_reason}</p>
              )}
            </div>
          ))}
          {boundOnly.map((l) => (
            <div key={l.code} className="rounded-lg border border-dashed border-amber-300 p-3 dark:border-amber-700" data-testid={`h14-bound-only-${l.code}`}>
              <div className="font-mono text-[12px] font-bold">{l.binding}</div>
              <p className="mt-1 text-[11px] leading-snug text-amber-800 dark:text-amber-300">
                HQ binds this code and the registry has no row for it, so nothing records what was provisioned there.
              </p>
            </div>
          ))}
        </div>
      )}
      {naming && (
        <p className="mt-3 text-[11px] leading-relaxed text-axal-faint" data-testid="h14-naming">
          Every branch names its own resources from its code: Worker and database <span className="font-mono">{naming.worker}</span>,
          host <span className="font-mono">{naming.hostname}</span>, queue <span className="font-mono">{naming.queue}</span>,
          buckets <span className="font-mono">{Object.values(naming.r2 || {}).join(', ')}</span>, search index{' '}
          <span className="font-mono">{naming.vectorize}</span>.
        </p>
      )}
    </Card>
  );
}

/**
 * The account-level services every Worker shares. Aggregates travel through
 * them; records never do.
 */
export function SharedCard({ topo }) {
  const a = topo?.analytics;
  const g = topo?.ai_gateway;
  const sharedBindings = (topo?.bindings || []).filter((b) => b.shared && b.name !== 'ANALYTICS');
  return (
    <Card>
      <SectionHead title="Shared by every Worker" sub="account-level: aggregates, never records" />
      <div className="divide-y divide-axal-hairline">
        <div className="py-2" data-testid="h14-shared-analytics">
          <div className="font-mono text-[11.5px] font-bold">Analytics Engine · {a?.dataset}</div>
          <ul className="mt-1 space-y-0.5 text-[11px] leading-snug text-axal-muted">
            {(a?.written_here || []).map((w) => <li key={w}>HQ writes {w.charAt(0).toLowerCase() + w.slice(1)}</li>)}
          </ul>
          <div className="mt-1.5 text-[11px] font-semibold">Read by</div>
          <ul className="mt-0.5 space-y-0.5 text-[11px] leading-snug text-axal-muted">
            {(a?.read_by || []).map((r) => <li key={r}>{r}</li>)}
          </ul>
          <p className="mt-1 text-[11px] text-axal-faint">
            {a?.readable_here
              ? 'This Worker holds the SQL API credentials, so it can read the dataset.'
              : 'This Worker cannot read the dataset: its SQL API credentials are not set here.'}
          </p>
          <div className="mt-1.5 text-[11px] font-semibold">Not from this dataset</div>
          <ul className="mt-0.5 space-y-0.5 text-[11px] leading-snug text-axal-faint" data-testid="h14-not-from-analytics">
            {(a?.not_from_here || []).map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>
        <div className="py-2" data-testid="h14-shared-gateway">
          <div className="font-mono text-[11.5px] font-bold">AI Gateway</div>
          <p className="mt-1 text-[11px] leading-snug text-axal-muted">
            {g?.slug_set
              ? `Routes ${(g?.routes || []).map((r) => r.label).join(' and ')} through the gateway. Every other model call goes to Workers AI directly.`
              : 'No gateway is set on this Worker, so every model call goes to Workers AI directly.'}
          </p>
          <p className="mt-1 text-[11px] leading-snug text-axal-faint" data-testid="h14-gateway-metadata">
            {/* D261 — WHICH calls carry it, never "each call": only the
                gatewayed task classes do, and only while a slug is set. */}
            {(g?.metadata?.carried_by || []).length > 0
              ? `Only ${g.metadata.carried_by.map((r) => r.label).join(' and ')} carry gateway metadata (${(g.metadata.keys || []).join(', ')}), so the gateway can split their spend by branch and by account. A call with no signed-in person behind it carries no account. Every other model call carries none.`
              : 'No gateway is set on this Worker, so no call carries metadata naming a branch or a person.'}
          </p>
        </div>
        {sharedBindings.map((b) => (
          <div key={b.name} className="py-2 text-[11px] text-axal-muted" data-testid={`h14-shared-${b.name}`}>
            <span className="font-mono font-bold text-axal-ink dark:text-gray-200">{b.kind}</span>
            {b.present
              ? <> — bound as <span className="font-mono">{b.name}</span>, one account-wide service.</>
              : <> — declared as <span className="font-mono">{b.name}</span> and not present on this Worker.</>}
          </div>
        ))}
        <div className="py-2 text-[11px] text-axal-muted" data-testid="h14-shared-tail">
          <span className="font-mono font-bold text-axal-ink dark:text-gray-200">Tail consumer · {topo?.tail?.consumer}</span>
          {' '}— receives HQ&rsquo;s logs and every branch&rsquo;s, named in each Worker&rsquo;s config.
        </div>
      </div>
    </Card>
  );
}

/**
 * What the page actually read, one line per read, for the rail (D126): a rail
 * that ran over "coverage" the page never loaded would summarise nothing.
 */
export function topologyCoverage(topo, deps) {
  const lines = [];
  if (topo && topo !== UNAVAILABLE) {
    const own = (topo.bindings || []).filter((b) => !b.shared);
    lines.push(`HQ: ${own.filter((b) => b.present).length} of ${own.length} own bindings present`);
    const calls = topo.rpc?.calls?.methods || [];
    lines.push(`${calls.length} methods HQ may call on a branch, ${calls.filter((m) => m.called).length} of them called`);
    lines.push(`${(topo.links?.branches || []).length} branch bindings on HQ`);
  }
  if (deps && deps !== UNAVAILABLE && deps.registry_available !== false) {
    lines.push(`${(deps.deployments || []).length} branches in the registry`);
  }
  return lines;
}

export default function PlatformTopologyPage() {
  const [topo, setTopo] = useState(null);
  const [deps, setDeps] = useState(null);
  const { branch: viewAs } = useViewAsBranch();

  const load = useCallback(() => {
    setTopo(null);
    setDeps(null);
    api.hqPlatformTopology().then(setTopo, (e) => { reportError('hq-platform-topology', e); setTopo(UNAVAILABLE); });
    api.deployments().then(setDeps, (e) => { reportError('hq-platform-topology:deployments', e); setDeps(UNAVAILABLE); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const topoReady = topo && topo !== UNAVAILABLE;
  const coverage = topologyCoverage(topo, deps);

  const rail = (
    <WorkerRail
      workspace="Topology"
      role="super_admin"
      stance="Reads the architecture back"
      note="This rail reads back what the page loaded: HQ's own bindings, the RPC surface in both directions, and the registry of branches. It changes nothing."
      coverage={coverage}
      coverageNote={coverage.length ? undefined
        : (topo === null ? 'Reading the topology…' : 'The topology could not be read, so there is nothing to read back.')}
      unavailable={[
        ['A branch’s own bindings', 'HQ reads a branch’s health over its binding, which reports its database and licence copy. Which bindings a branch holds is on that branch’s Settings page.'],
        ['A per-branch rollout or rollback', 'Every push to main redeploys each provisioned branch after HQ, all at once, so there is no staged rollout or rollback to show per branch.'],
      ]}
      data-testid="hq-topology-rail"
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-6" data-testid="hq-topology-page">
      <div className="min-w-0 space-y-4">
        <div>
          <Link to="/admin/platform" className="inline-flex items-center gap-1 text-[12px] font-semibold text-axal-muted hover:text-axal-ink dark:hover:text-gray-100">
            <ArrowLeft size={13} /> Platform
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-extrabold tracking-tight">
            <Network size={18} aria-hidden="true" /> Topology
          </h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
            What HQ can read, and through what. HQ reads a branch&rsquo;s records over one binding per branch, and that
            read can fail for one branch while the others answer. Aggregates never travel that way.
          </p>
          {viewAs && (
            <p className="mt-1.5 max-w-2xl text-[11.5px] leading-relaxed text-axal-faint" data-testid="hq-topology-view-as">
              Viewing as {viewAs} does not narrow this page: it describes HQ&rsquo;s Worker and the registry of every
              branch, not one branch&rsquo;s records.
            </p>
          )}
        </div>

        {topo === null && <p className="text-[12.5px] text-axal-muted">Reading the topology…</p>}
        {topo === UNAVAILABLE && (
          <Unreadable what="The topology" claim="This is not a claim that anything is unbound." onRetry={load} />
        )}

        {topoReady && <DeploysStrip deploys={topo.deploys} dispatch={topo.deploy_dispatch} />}
        {topoReady && <HqWorkerCard topo={topo} />}

        {deps === null && <p className="text-[12.5px] text-axal-muted">Reading the registry of branches…</p>}
        {deps === UNAVAILABLE && (
          <Unreadable what="The registry of branches" claim="This is not a claim that no branch exists." onRetry={load} />
        )}
        {deps && deps !== UNAVAILABLE && deps.registry_available === false && (
          <Card>
            <Unrecorded reason={deps.registry_reason}>The registry of branches</Unrecorded>
          </Card>
        )}
        {deps && deps !== UNAVAILABLE && deps.registry_available !== false && (
          <BranchBoxes
            deps={deps}
            links={topoReady ? topo.links?.branches || [] : topo === null ? undefined : null}
            naming={topoReady ? topo.branch_naming : null}
          />
        )}

        {topoReady && <SharedCard topo={topo} />}
      </div>

      <div className="mt-4 lg:mt-0">{rail}</div>
    </div>
  );
}
