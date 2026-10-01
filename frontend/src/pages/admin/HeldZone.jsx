import React from 'react';
import { WorkerRail } from '../../ui';

/**
 * The frame the five S20 landings render in — the Admin shell on accounts HQ
 * holds directly (D286) — and that shell's ONE Worker AI rail mount.
 *
 * WHAT THIS SHELL IS. No branch is deployed yet (`infra/branches` holds only
 * `_example.json`, and `tenancyScope.ts` leaves `admin` unscoped), so every
 * plain admin today administers accounts on HQ's own database, on axal.vc.
 * S20 draws that shell as the branch shell's eight rows with every row
 * pointing at the `/admin` console that already does that work on HQ, never
 * at `/branch/*`, which refuses on HQ. `BranchZone` is the branch tier's
 * frame and reads `/me.branch`; this one reads nothing, because the fact it
 * states — HQ's database, no branch behind it — is the deployment's, not a
 * row's.
 *
 * THE SCOPE SENTENCE IS ALWAYS VISIBLE, and it is the host's, not a page's:
 * S20's wall rules hold on these landings only because no branch exists yet,
 * and a rule that is true for that reason has to say so where it is applied.
 * It sits here so no landing can ship without it.
 *
 * THE RAIL DECLINES NOTHING, BECAUSE IT CANNOT ASK. S20 mounts the AdminRail
 * with `scope="HQ-held accounts"` and its decline card is drawn only behind a
 * `decline` prop S20 does not pass (D282, tension 2). What is true is what
 * `BranchZone` already says for a branch: the rail has no free-text input and
 * one D1 binding, so a question about a branch is one it cannot ask. The
 * sentence says that, and names the read it does have.
 */
export const HELD_SCOPE = 'HQ-held accounts · axal.vc';
export const HELD_SCOPE_NOTE = 'No branch is deployed yet, so these accounts have no branch database. '
  + 'Every row of this shell points at the console that already does that work on HQ; '
  + 'nothing here reads or links a page under /branch/, which refuses on HQ.';

export default function HeldZone({
  workspace,
  stance = 'Read-only summary',
  coverage = [],
  coverageNote,
  unavailable = [],
  children,
}) {
  const note = 'This rail reads HQ’s own database — the accounts HQ holds on axal.vc — and no other. '
    + 'No branch is deployed yet, so there is no branch read behind it: a question about a branch '
    + 'is one it cannot ask rather than one it declines.';
  return (
    <div
      className="lg:grid lg:items-start lg:gap-6"
      style={{ gridTemplateColumns: 'minmax(0,1fr) var(--fwr-track, 280px)' }}
      data-testid="held-zone"
    >
      <div className="min-w-0">
        <p
          className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11.5px] leading-relaxed text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300"
          data-testid="held-scope"
        >
          <span className="font-extrabold uppercase tracking-[.07em]">{HELD_SCOPE}</span>
          {' — '}
          {HELD_SCOPE_NOTE}
        </p>
        {children}
      </div>
      <div className="mt-4 lg:mt-0">
        <div className="lg:sticky lg:top-20">
          <WorkerRail
            workspace={workspace}
            role="admin"
            stance={stance}
            note={note}
            coverage={coverage}
            coverageNote={coverageNote}
            unavailable={unavailable}
            data-testid="held-rail"
          />
        </div>
      </div>
    </div>
  );
}
