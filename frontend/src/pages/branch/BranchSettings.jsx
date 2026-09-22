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
// NO NEW `/api/*` METHOD. Two reads the branch already has: `myLicence()` for
// the pushed copy and its stamp, `branchInsights()` for the role breakdown
// (which that route computed and dropped until D155).
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Settings, Lock } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, Unrecorded, Unreadable } from '../../ui';
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

export default function BranchSettings({ user }) {
  const [licence, setLicence] = useState(null);
  const [insights, setInsights] = useState(null);

  const load = useCallback(() => {
    setLicence(null);
    setInsights(null);
    // TWO READS, TWO STATES. A failed licence read must not empty the staff
    // row and vice versa: they answer different questions and one being
    // unreadable is not evidence about the other.
    api.myLicence().then(setLicence, (e) => { reportError('branch-settings:licence', e); setLicence(UNAVAILABLE); });
    api.branchInsights().then(setInsights, (e) => { reportError('branch-settings:insights', e); setInsights(UNAVAILABLE); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const lic = licence && licence !== UNAVAILABLE ? licence.licence || null : null;
  const ins = insights && insights !== UNAVAILABLE ? insights : null;
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
      field: 'Brand kit',
      who: 'HQ',
      value: null,
      reason: 'HQ has no brand-kit store yet, so there is nothing to download. Ask for assets through Content; do not expect a file here.',
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
  ];

  return (
    <BranchZone
      workspace="Settings"
      user={user}
      stance="Read-only settings"
      coverage={coverage}
      coverageNote={licence === UNAVAILABLE ? 'The licence copy could not be read.' : undefined}
      unavailable={[
        ['A brand kit to download', 'HQ has no brand-kit store (D.10), so there is nothing to push and nothing to fetch. Assets are asked for through Content.'],
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
      </div>
    </BranchZone>
  );
}
