import React, { useState } from 'react';
import { Users } from 'lucide-react';
import AdminPage from '../AdminPage';
import SuperAdminHolders from './SuperAdminHolders';
import HqTeamTable from './HqTeamTable';
import HqTeamActions from './HqTeamActions';
import { Unrecorded, WorkerRail } from '../../ui';
import { useViewAsBranch } from '../../contexts/ViewAsBranchContext';

/**
 * HQ · Team — the cross-tenant people desk (canvas H4, H9 since D138, H20 since D221).
 *
 * FOUR THINGS IN ONE ORDER, and the order is H20's: who holds the elevation,
 * then who the administrators are and what the compliance ladder says about
 * each, then the two action cards — what only HQ may do and what every admin
 * may — and last the full directory. Nothing is duplicated: the directory is
 * the Admin Console's own Users panel, mounted locked to that section, with its
 * counts, filters, detail drawer and impersonation.
 *
 * NOTHING RETIRES. H20's subtitle says it "retires the /admin Users table". It
 * does not: the brief this build answers to keeps every /admin route reachable,
 * and the Users table stays where it is, which is also what the directory
 * below mounts. What the Team page adds is the part H20 is actually about —
 * the line between HQ's powers and an admin's, drawn as two cards.
 *
 * UNDER THE OVERLAY THE HOLDER CONSOLE AND THE DIRECTORY ARE NOT RENDERED.
 * Both read HQ's own database — the elevation's holders and every account on
 * it — and D153's overlay is "one private-link read, of one branch". Drawing
 * them beneath a banner saying the page is one branch's would put HQ's rows
 * under a branch's name. The Team table reads the branch; the rest says why
 * it is not here.
 *
 * THE DIRECTORY'S TENANT COLUMN is still not drawn, and the reason is narrower
 * than it was rather than gone: `licence_admins` names the licence an
 * ADMINISTRATOR holds, which is what the Team table reads, but no ordinary
 * account names a licence at all (UNRESOLVED_ITEMS U1).
 */
export default function HqAccountsPage({ onImpersonate }) {
  // Granting or revoking the elevation changes a badge in the Team table, so
  // the two are kept in step rather than left to disagree until a reload. The
  // `onSaved` idiom D134's `AdminsEditor` already uses, one level up.
  const [reloadKey, setReloadKey] = useState(0);
  // D221 — what the Team table read, handed up so the rail can say it. The
  // table's own three states: undefined loading, null unreadable, an object.
  const [team, setTeam] = useState(undefined);
  const { branch: viewAs } = useViewAsBranch();

  const scope = team && team.scope ? team.scope : null;
  const coverage = [
    team && !viewAs && typeof team.total === 'number'
      && `${team.total} administrator${team.total === 1 ? '' : 's'} on HQ's database${typeof team.active === 'number' ? `, ${team.active} active` : ''}`,
    team && !viewAs && (team.ladder_readable === false
      ? 'Compliance ladder: unreadable, so no rung is shown'
      : 'A compliance rung read for each administrator'),
    team && !viewAs && (team.licences_available === false
      ? 'Licence bindings: unreadable'
      : 'The licence each administrator holds'),
    team && scope && `${scope.branch} read alone — ${scope.status === 'ok' ? 'it answered' : scope.status === 'not_deployed' ? 'not deployed' : 'it did not answer'}`,
    team && !scope && team.branches_coverage
      && (team.branches_coverage.total
        ? `Of ${team.branches_coverage.total} branches, ${team.branches_coverage.answered} answered`
        : 'No branch is provisioned, so every administrator is HQ-held'),
  ].filter(Boolean);

  const rail = (
    <WorkerRail
      workspace="Team"
      role="super_admin"
      stance="Reads the roster; the holder console and the directory keep their own controls"
      note="The administrator roster, the compliance ladder and each branch's answer are read from their stores. The two action cards state what each power needs, where it is done and whether Security records it — they carry no control of their own."
      coverage={coverage}
      coverageNote={team === undefined ? 'Loading…' : team === null ? 'The administrator roster could not be read.' : undefined}
      unavailable={[
        ['A tenant per ordinary account', 'No account but an administrator names a licence (U1), so the directory has no Branch column to read.'],
        ['Deciding KYC, access or the Lab for a branch account', 'A branch hit shows its KYC, access and Lab state (D260), read-only. Deciding them is the branch admin’s, on its own Admin Console. A suspended branch gives no KYC verdict, grants no limited access and admits no one to the Lab; it can still revoke limited access.'],
        ['Trust on a branch account', 'Trust is computed over HQ’s own accounts and is not a per-branch figure.'],
        ['Telling a branch account HQ supports', 'An HQ-held account is told when a support session opens on it (D248), and both parties to a transfer of the elevation are told (D241). An account on a branch is not told yet: the branch records the session and sends no notice.'],
      ]}
      data-testid="hq-team-rail"
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-6" data-testid="hq-accounts-page">
      <div className="min-w-0 space-y-5">
        <header>
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
            <Users size={13} /> HQ · Team
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink">Team</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
            Who holds the elevation, every administrator with their licence and compliance state, what
            only HQ may do and what every admin may, and below them every account on the platform in the
            same table the Admin Console keeps.
            Tenant per ordinary account: <Unrecorded /> — an administrator names the licence they
            hold, but no other account does yet, so the directory has no tenant column to read.
          </p>
        </header>

        {viewAs ? (
          <p className="text-[12px] leading-relaxed text-axal-muted" data-testid="hq-team-view-as-omitted">
            The holder console and the account directory are not drawn while reading {viewAs}: both read
            HQ&rsquo;s own database, and a branch&rsquo;s answer shown beside HQ&rsquo;s rows would put
            HQ&rsquo;s accounts under {viewAs}&rsquo;s name. Return to HQ view to see them.
          </p>
        ) : (
          <SuperAdminHolders onChanged={() => setReloadKey((n) => n + 1)} />
        )}

        <HqTeamTable reloadKey={reloadKey} onLoaded={setTeam} />

        <HqTeamActions viewAs={viewAs} />

        {!viewAs && (
          <>
            <p className="text-[11.5px] leading-relaxed text-axal-faint" data-testid="hq-team-directory-caption">
              Every account on HQ&rsquo;s own database, so every row is HQ-held — a Branch column here would
              read the same word on every line. A branch&rsquo;s accounts live on its own database and are
              asked for through the Team search above.
            </p>
            <AdminPage onImpersonate={onImpersonate} section="users" />
          </>
        )}
      </div>
      <div className="mt-6 lg:mt-0">{rail}</div>
    </div>
  );
}
