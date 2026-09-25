// Branch · Settings — who owns each row (Admin · Subsidiary canvas, S11) — D155.
//
// WHAT THE ARTBOARD IS FOR, in its own words: "HQ-owned rows show the request
// path instead of a disabled input: a greyed field invites a ticket asking to
// enable it; a chip saying HQ and a route saying 'escalation' answers the
// question on the page."
//
// THE CANVAS IS WRONG ABOUT WHO OWNS TWO OF ITS FIVE ROWS, and correcting that
// is most of this page. It draws "Subsidiary name · Yours · Edit" and "Staff &
// roles · Yours · Edit". Measured against the code:
//
//   · SUBSIDIARY NAME IS HQ'S, twice over. The name this deployment answers by
//     is `BRANCH_NAME`, a Worker var set at provisioning — `routes/auth.ts`
//     says so where it builds `/me.branch`: "THE VARS ARE THE SOURCE, NOT THE
//     DATABASE." Changing it is a redeploy, not a form. And the licence copy's
//     `brand_name` is HQ's: there is not one `UPDATE branch_licence` anywhere
//     in the worker, by design (D.9 — HQ authors, branches read), so a branch
//     that edited it would have the edit overwritten by HQ's next push.
//   · ROLES ARE HQ'S. `PATCH /users/:userId/role` answers
//     `admin_promotion_disabled` to everyone but the super admin, and on a
//     branch `hydrateSuperAdmin` returns 0 without querying (D106) — so a
//     branch admin can never change a role, and D134 made the licence the only
//     door for granting one.
//   · WHAT A BRANCH GENUINELY OWNS on that row is narrower and real: it can
//     deactivate or reactivate a NON-ADMIN account on its own database.
//     `toggle-active` refuses only an ADMIN target (D132).
//
// So the ownership count is not the canvas's. Drawing an "Edit" beside a field
// the server refuses is the `still_an_admin` mistake D134 named — a UI that
// offers a button and lets the server say no teaches the operator that one of
// its buttons is a lie — and it is worse here than usual, because the whole
// point of this artboard is to answer "who owns this?" on the page.
//
// THREE READS, EACH WITH ITS OWN STATE. `myLicence()` for the pushed copy and
// its stamp, `branchInsights()` for the role breakdown (which that route
// computed and dropped until D155), and — since D209 — `branchDeployment()`
// for S14, the one `/api/*` method this page added: what this Worker is and
// what it is not, answered from the same service HQ's Topology page reads.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Settings, Lock } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, Unrecorded, Unreadable } from '../../ui';
import { TopologyTag, RpcSide } from '../../components/TopologyParts';
import BranchZone from './BranchZone';

const UNAVAILABLE = Symbol('unavailable');
const stamp = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : null);

/** Who owns a row, and the chip that says so. Two values, because there are two. */
function Owner({ who }) {
  const hq = who === 'HQ';
  return (
    <span
      data-testid={`s11-owner-${hq ? 'hq' : 'yours'}`}
      className={`rounded border px-1.5 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[.05em] ${
        hq
          ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
          : 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
      }`}
    >
      {hq ? 'HQ' : 'Yours'}
    </span>
  );
}

function Row({ field, value, reason, who, act, actTo }) {
  return (
    <div className="border-t border-axal-hairline py-3 first:border-t-0" data-testid="s11-row" data-owner={who}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[12.5px] font-extrabold tracking-tight">{field}</span>
        <Owner who={who} />
      </div>
      <div className="mt-1 text-[12px] text-axal-muted">
        {value ?? <Unrecorded reason={reason} />}
      </div>
      {/* THE REQUEST PATH, NEVER A DISABLED INPUT. On an HQ-owned row this is
          a link to where the ask is actually made; on a branch-owned one it is
          a link to the console that performs it. Either way it goes somewhere
          that works — a control that could only refuse is not drawn. */}
      <div className="mt-1.5 text-[11.5px]">
        {who === 'HQ' && <Lock size={11} className="mr-1 inline text-axal-faint" aria-hidden="true" />}
        <Link to={actTo} className="underline">{act}</Link>
      </div>
    </div>
  );
}

/**
 * S14 · THIS DEPLOYMENT (D209) — what this branch Worker is, and what it is not.
 *
 * WHY IT IS ON SETTINGS. The canvas draws S14 as the architecture every
 * S-screen honours, stated once; Settings is the one branch page whose subject
 * is what this branch IS rather than what it holds. It renders
 * `GET /api/branch/deployment`, which answers from `services/topology.ts` —
 * the service HQ's Topology page reads too — so the two tiers cannot describe
 * one architecture two ways.
 *
 * WHAT THE CANVAS GOT WRONG, AND THIS DOES NOT REPEAT. S14 drew the branch as
 * deployed by the push-to-main workflow (it is provisioned once, and nothing
 * deploys it again), its entrypoint as "accounts, queues, statement, audit"
 * (HQ may call twelve methods, listed from the class), and its search index
 * under the wrong name. Every one of those now comes off the payload.
 *
 * THE "CANNOT" LIST IS READ, NOT RECITED. Two of S14's three refusals depend
 * on what this Worker was given — a hand-added binding, a pair of SQL API
 * credentials — so the service checks each one here and says which way it came
 * out. One that stopped holding is drawn as such, with its reason, and never
 * as a tick.
 */
export function DeploymentZone({ dep }) {
  const own = (dep?.bindings || []).filter((b) => !b.shared);
  const missing = own.filter((b) => !b.present);
  const a = dep?.analytics || {};
  const g = dep?.ai_gateway || {};
  const hq = dep?.links?.hq;
  const others = dep?.links?.branches || [];
  const cannot = dep?.cannot || [];
  return (
    <section className="mt-6" data-testid="s14-deployment">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[16px] font-extrabold tracking-tight">This deployment</h2>
        <span className="font-mono text-[11px] text-axal-faint" data-testid="s14-identity">
          {dep?.hostname} · {dep?.worker}
        </span>
      </div>
      {/* THE BINDING COUNT IS READ, NOT RECITED: a hand-added BRANCH_ line, or
          a missing HQ one, makes "one service binding, to HQ" untrue here. */}
      <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-axal-muted" data-testid="s14-summary">
        This branch is its own Worker over its own database.{' '}
        {!hq?.bound
          ? 'It holds no binding to HQ'
          : others.length === 0
            ? 'It holds one service binding, to HQ'
            : `It holds a binding to HQ and ${others.length === 1 ? 'one to another branch' : `${others.length} to other branches`}, which a generated config never writes`}
        , and exports one entrypoint HQ may call. Every page here reads this branch&rsquo;s own database.
      </p>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card>
          <h3 className="text-[13px] font-extrabold tracking-tight">Its own resources</h3>
          <div className="mt-2 flex flex-wrap gap-1.5" data-testid="s14-own">
            {own.map((b) => (
              <TopologyTag key={b.name} muted={!b.present}>
                {b.name}{b.resource ? ` · ${b.resource}` : ''}
              </TopologyTag>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-axal-faint" data-testid="s14-own-note">
            {missing.length === 0
              ? `All ${own.length} are present on this Worker, and every one is this branch's alone.`
              : `Declared and not present on this Worker: ${missing.map((b) => b.name).join(', ')}.`}
            {' '}Where the database sits was chosen at provisioning and is recorded at HQ, not here.
          </p>
        </Card>

        <Card>
          <h3 className="text-[13px] font-extrabold tracking-tight">The one binding · HQ</h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-axal-muted" data-testid="s14-hq-link">
            {hq?.bound
              ? `Bound to HQ's ${hq.service} Worker, through ${hq.entrypoint}.`
              : 'No HQ binding is present on this Worker, so nothing this branch raises can reach HQ.'}
          </p>
          <div className="mt-1 divide-y divide-axal-hairline">
            <RpcSide side={dep?.rpc?.exports} heading="HQ calls this branch" exportedBy="this branch" />
            <RpcSide side={dep?.rpc?.calls} heading="This branch calls HQ" exportedBy="HQ" />
          </div>
        </Card>

        <Card>
          <h3 className="text-[13px] font-extrabold tracking-tight" data-testid="s14-analytics-head">
            {a.readable_here ? 'Writes to, and can read' : 'Writes to, cannot read'}
          </h3>
          <div className="mt-2 font-mono text-[11px] font-bold">Analytics Engine · {a.dataset}</div>
          <ul className="mt-1 space-y-0.5 text-[11px] leading-snug text-axal-muted">
            {(a.written_here || []).map((w) => (
              <li key={w}>This branch writes {w.charAt(0).toLowerCase() + w.slice(1)}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] leading-snug text-axal-faint" data-testid="s14-gateway">
            {/* D261 — only the gatewayed task classes carry it, and only while a slug is set. */}
            {(g.metadata?.carried_by || []).length > 0
              ? `Only ${g.metadata.carried_by.map((r) => r.label).join(' and ')} carry metadata naming this branch, so gateway spend can be split by branch for those alone. Every other model call carries none.`
              : 'No gateway is set on this Worker, so no model call carries metadata naming this branch, and gateway spend cannot be split by branch.'}
          </p>
          <div className="mt-3 text-[11px] font-extrabold uppercase tracking-[.06em] text-axal-faint">
            What this Worker cannot do
          </div>
          <ul className="mt-1 space-y-2">
            {cannot.map((c) => (
              <li key={c.what} data-testid="s14-cannot" data-holds={c.holds ? 'yes' : 'no'} className="text-[11px] leading-snug">
                <div className="flex flex-wrap items-baseline gap-1.5">
                  <b>{c.what}</b>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase ${
                      c.holds
                        ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                    }`}
                  >
                    {c.holds ? 'holds here' : 'does not hold here'}
                  </span>
                </div>
                <div className="mt-0.5 text-axal-muted">{c.why}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {dep?.deploys?.branch_redeployed === true && dep.deploys.branch_deployed_by && (
        <p className="mt-3 max-w-2xl text-[11.5px] leading-relaxed text-axal-faint" data-testid="s14-redeployed">
          Redeployed after HQ on every push to main, by <span className="font-mono">{dep.deploys.branch_deployed_by}</span>, so
          this Worker runs main&rsquo;s code.
          {dep.deploys.branch_provisioned_by && (
            <> Provisioned by <span className="font-mono">{dep.deploys.branch_provisioned_by}</span>.</>
          )}
        </p>
      )}
      {dep?.deploys?.branch_redeployed === false && dep.deploys.branch_deployed_by && (
        <p className="mt-3 max-w-2xl text-[11.5px] leading-relaxed text-axal-faint" data-testid="s14-deployed-once">
          Deployed once, by <span className="font-mono">{dep.deploys.branch_deployed_by}</span>. Nothing deploys a
          branch a second time, so this Worker runs the code it was provisioned with.
        </p>
      )}
    </section>
  );
}

export default function BranchSettings({ user }) {
  const [licence, setLicence] = useState(null);
  const [insights, setInsights] = useState(null);
  const [deployment, setDeployment] = useState(null);

  const load = useCallback(() => {
    setLicence(null);
    setInsights(null);
    setDeployment(null);
    // THREE READS, THREE STATES. A failed licence read must not empty the
    // staff row and vice versa: they answer different questions and one being
    // unreadable is not evidence about the other. The deployment read is the
    // same rule a third time — it describes this Worker, not its records.
    api.myLicence().then(setLicence, (e) => { reportError('branch-settings:licence', e); setLicence(UNAVAILABLE); });
    api.branchInsights().then(setInsights, (e) => { reportError('branch-settings:insights', e); setInsights(UNAVAILABLE); });
    api.branchDeployment().then(setDeployment, (e) => { reportError('branch-settings:deployment', e); setDeployment(UNAVAILABLE); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const lic = licence && licence !== UNAVAILABLE ? licence.licence || null : null;
  const ins = insights && insights !== UNAVAILABLE ? insights : null;
  const dep = deployment && deployment !== UNAVAILABLE ? deployment : null;
  const asOf = stamp(licence && licence !== UNAVAILABLE ? licence.as_of || lic?.pushed_at : null);
  const copyNote = asOf ? `copy as of ${asOf}` : 'copy with no push stamp';

  const byRole = ins?.stats?.by_role || null;
  const staffLine = byRole
    ? Object.entries(byRole)
      .filter(([, n]) => Number(n) > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([role, n]) => `${n} ${role}${Number(n) === 1 ? '' : 's'}`)
      .join(' · ')
    : null;

  // THE ROWS ARE DATA, NOT SEVEN JSX LITERALS, and D197 made them so for one
  // reason: the count beside them had been a TYPED string sitting under a
  // comment that claimed it was counted. Reading one array is what makes the
  // sentence true, and it makes the render and the guard read the same thing —
  // a row added here reaches both or neither.
  const rows = [
    {
      field: 'Subsidiary name',
      who: 'HQ',
      value: lic?.brand_name ? `${lic.brand_name} · ${copyNote}` : null,
      reason: 'The licence copy could not be read, so the name it carries is unknown rather than unset.',
      act: 'Request a change · escalation (other)',
      actTo: '/branch/approvals',
    },
    {
      field: 'Territory',
      who: 'HQ',
      value: lic?.territories?.length ? `${lic.territories.join(' · ')} · ${copyNote}` : null,
      reason: 'The licence copy could not be read, so which countries this branch holds is unknown rather than none.',
      act: 'Request a change · escalation (other)',
      actTo: '/branch/approvals',
    },
    {
      field: 'Staff & roles',
      who: 'Yours',
      value: staffLine,
      reason:
        insights === UNAVAILABLE
          ? 'The account breakdown could not be read, so the staff count is unknown rather than zero.'
          : 'The branch answered without a role breakdown.',
      // SPLIT, AND THE LINK GOES TO THE HALF THAT WORKS. A branch can
      // deactivate a non-admin account on its own database; it cannot change a
      // role, and granting one is HQ's through the licence (D134).
      act: 'Manage accounts — roles are granted by HQ through the licence',
      actTo: '/branch/accounts',
    },
    {
      // D198 — THE REASON CHANGED AND THE ROW DID NOT, which is the honest
      // correction rather than the flattering one. HQ now records a brand kit
      // (migration 281), so "HQ has no brand-kit store yet" stopped being true
      // the day that shipped. Two things are still true and they are what this
      // row now says. A kit belongs to a WHITE-LABEL licence — an Axal
      // subsidiary trades under Axal's brand, which is fixed and is not stored
      // per licence, so for a subsidiary there is nothing here by design rather
      // than by omission. And nothing pushes a kit to a branch yet: the copy
      // and the mark's bytes crossing from HQ's object store to this one is a
      // transport decision that has not been made. The chip stays 'HQ' because
      // `wlCompare` puts a subsidiary's brand at HQ either way.
      field: 'Brand kit',
      who: 'HQ',
      value: null,
      reason: 'A brand kit belongs to a white-label licence; an Axal subsidiary trades under Axal\u2019s '
        + 'brand, which is fixed and is not stored per branch. HQ records one where a licence has '
        + 'one, and nothing pushes it to a branch yet \u2014 so there is still no file to fetch here.',
      act: 'Ask HQ · Content',
      actTo: '/branch/approvals',
    },
    {
      field: 'Licence summary',
      who: 'HQ',
      value: lic
        ? `${Number.isFinite(Number(lic.seats_licensed)) ? lic.seats_licensed : 'an unrecorded number of'} seats${lic.renews_on ? ` · renews ${String(lic.renews_on).slice(0, 10)}` : ''} · ${copyNote}`
        : null,
      reason: 'The licence copy could not be read, so its terms are unknown rather than absent.',
      act: 'Request seats · escalation (seat increase)',
      actTo: '/branch/approvals',
    },
    {
      // THE CANVAS TYPES A VALUE HERE AND THE PAGE REFUSES TO. S11 draws
      // "D1 · DO · R2 with jurisdiction eu" on this row. `branch_licence` has
      // no residency column and HQ pushes none, so printing that would be a
      // claim about THIS deployment that nothing on this deployment measured.
      field: 'Data residency',
      who: 'HQ',
      value: null,
      reason: 'Nothing pushes this branch its own residency, so where its data sits is unknown here rather than unset. It is chosen at provisioning and HQ holds the record.',
      act: 'Ask HQ · escalation (other)',
      actTo: '/branch/approvals',
    },
    {
      // D197. The canvas puts Domain in a Settings sub-nav this page does not
      // have, so it lands as a row — where its owner chip can say the true
      // thing. The host register is HQ's structurally: "one host, one licence"
      // is a UNIQUE index, and a branch is its own Worker over its own D1, so
      // it cannot see what another tenant bound and cannot enforce it.
      field: 'Domain',
      who: 'HQ',
      value: null,
      reason: 'The host register is HQ\'s, so this branch cannot read which host its licence holds. Binding one is done on the licence at HQ.',
      act: 'Ask HQ · escalation (other)',
      actTo: '/branch/approvals',
    },
  ];
  const hqOwned = rows.filter((r) => r.who === 'HQ').length;
  const ownerCount = `${hqOwned} of ${rows.length} rows HQ-owned`;

  // THE RAIL IS `BranchZone`'S, NOT THIS PAGE'S. D126 put the branch tier's
  // one mount there and `branch_rail_mount.test.mjs` pins it, so a page passes
  // its COVERAGE and its ABSENCES and never a second `<WorkerRail>` — which is
  // the doubled-chrome defect that guard exists to prevent. D151 is why the
  // coverage lines below are real rather than empty: three branch zones passed
  // none, and a rail with no coverage tells the reader it has nothing to read
  // back from a page that has just loaded one.
  const coverage = [
    // NOT `|| 0`. A licence copy that arrived without a territories array has
    // an unknown territory count, and "0 territories held" is a claim about
    // this branch's licence that nothing measured — the exact defect the
    // page-wide ban exists for.
    (lic && Array.isArray(lic.territories))
      ? `${lic.territories.length} territories held · ${copyNote}`
      : 'Territories: not read',
    staffLine ? `Staff: ${staffLine}` : 'Staff breakdown: not read',
    ownerCount,
    dep
      ? `This deployment: ${dep.worker}, ${(dep.cannot || []).filter((c) => c.holds).length} of ${(dep.cannot || []).length} refusals hold`
      : 'This deployment: not read',
  ];

  return (
    <BranchZone
      workspace="Settings"
      user={user}
      stance="Read-only settings"
      coverage={coverage}
      coverageNote={licence === UNAVAILABLE ? 'The licence copy could not be read.' : undefined}
      unavailable={[
        ['A brand kit to download', 'A kit belongs to a white-label licence, and this shell trades under Axal\u2019s brand. HQ records one where a licence has one (D198) and nothing pushes it to a branch yet, so there is nothing to fetch. Assets are asked for through Content.'],
        ['Editing the subsidiary name here', 'The name is a Worker var set at provisioning, and the licence copy is HQ\'s. A field here would either need a redeploy or be overwritten by HQ\'s next push.'],
      ]}
    >
      <div className="min-w-0">
        <header>
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
            <Settings size={13} /> Branch · Settings
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink">Who owns each row</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
            Every row says who decides it. An HQ-owned row shows where to ask rather than a field that would
            refuse — a greyed input invites a ticket asking to enable it, and there is nothing to enable.
          </p>
        </header>

        {licence === UNAVAILABLE && (
          <div className="mt-4">
            <Unreadable what="Your licence copy" claim="This is not a claim that HQ has not pushed one." onRetry={load} />
          </div>
        )}

        <Card className="mt-4">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 className="text-[14.5px] font-extrabold tracking-tight">Settings</h2>
            {/* COUNTED, AND SINCE D197 ACTUALLY SO. This comment sat above a
                typed string for two decisions; the value is now derived from
                the same `rows` array the list below renders, so the day a row
                changes hands both change together. */}
            <span className="text-[11.5px] text-axal-faint" data-testid="s11-owner-count">
              {ownerCount}
            </span>
          </div>

          {rows.map((r) => <Row key={r.field} {...r} />)}

        </Card>

        <p className="mt-3 text-[11px] leading-relaxed text-axal-faint" data-testid="s11-ownership-note">
          The artboard marks <b>Subsidiary name</b> and <b>Staff &amp; roles</b> as this branch&rsquo;s to edit.
          Measured against the code, the name is a Worker var set at provisioning and the licence copy is
          HQ&rsquo;s — nothing in the worker writes <code>branch_licence</code> — and a role cannot be changed
          from a branch at all. What this branch does own on that row is deactivating a non-admin account,
          which is the link above. Drawing an Edit beside a field the server refuses is what this page exists
          not to do.
        </p>

        {deployment === null && (
          <p className="mt-6 text-[12.5px] text-axal-muted">Reading this deployment…</p>
        )}
        {deployment === UNAVAILABLE && (
          <div className="mt-6">
            <Unreadable what="This deployment's description" claim="This is not a claim that anything is unbound." onRetry={load} />
          </div>
        )}
        {dep && <DeploymentZone dep={dep} />}
      </div>
    </BranchZone>
  );
}
