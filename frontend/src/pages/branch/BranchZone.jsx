import React from 'react';
import { WorkerRail } from '../../ui';
import { branchLabel } from '../../lib/shellRole';

/**
 * The frame every `/branch/*` route renders in — and the branch tier's ONE
 * Worker AI rail mount (D126).
 *
 * WHY ONE MOUNT RATHER THAN EIGHT. Eight routes each building their own
 * two-column layout is how the HQ tier ended up with five hand-written copies
 * of the same Tailwind grid, three of which then drifted into passing props
 * `WorkerRail` does not declare. The mount lives here, the routes pass
 * content, and `frontend/test/branch_rail_mount.test.mjs` pins that there is
 * exactly one `<WorkerRail>` under `pages/branch/`. PRs 12–14 fill these zones
 * in; none of them has to remember how the rail is mounted.
 *
 * THE RAIL COLUMN READS `--fwr-track`, WHICH IS THE COLLAPSE MECHANISM.
 * `workerRail.css` sets `--fwr-track: 44px` on
 * `:root[data-worker-rail="collapsed"]`, so every host declaring its column as
 * `var(--fwr-track, <own width>)` narrows when the reader collapses the rail.
 * `WorkspaceShell.jsx:245` is the precedent. The five HQ pages hardcode `280px`
 * in a Tailwind literal instead and do not collapse — noted rather than fixed
 * here, because it is a different defect and it affects two pages this PR has
 * no other reason to touch.
 *
 * THE DEPLOYMENT SENTENCE IS THE HOST'S, NOT A PAGE'S. S12 draws a card that
 * declines a cross-branch question. It cannot be honestly built: the rail has
 * no free-text input, `services/aiRouter.ts` carries no branch awareness, and a
 * branch Worker has exactly one D1 binding — so the question cannot be ASKED,
 * and a card refusing it would be theatre about a wall that is already
 * load-bearing. One always-visible sentence says the true thing instead, and it
 * sits here so no zone can ship without it.
 *
 * D151 — THAT SENTENCE NOW NAMES THE BRANCH, which is S12's rule 1. The canvas
 * draws it as a chip reading "Axal VC France" with no caret, and the chip is
 * NOT what ships. Two measurements decided that: the territory badge
 * (`App.jsx`) already names the branch on every branch screen, so a chip would
 * be a second copy of one string on one screen; and D150 refused H13's HQ chip
 * on the grounds that its options cannot differ, so a branch chip would be
 * contrasting with nothing. What the chip's information content actually is —
 * *this one, and it does not open* — was already this sentence. What the
 * sentence lacked was the name.
 *
 * `branchLabel` returns null off a branch or on an older `/me`, and the
 * sentence stays true either way rather than rendering "reads null's database".
 *
 * NOT `WorkspaceShell`. That shell draws a bucket crumb, a zone pill row and a
 * scope line defaulted from `ActiveCompanyContext` — all three inert or wrong
 * on a branch (`bucketsFor('branch_admin')` is `[]`, and the active company is
 * the admin's own, not the territory). It also owns `p-5`, which `App.jsx`
 * already gives these routes. What was worth reusing is the track variable, and
 * that is what is reused.
 */
export default function BranchZone({
  workspace,
  user,
  stance = 'Read-only summary',
  coverage = [],
  coverageNote,
  unavailable = [],
  children,
}) {
  const label = branchLabel(user);
  const note = label
    ? `This rail reads ${label}'s database and no other. There is no cross-branch read behind it, `
      + 'so a question about another territory is one it cannot ask rather than one it declines.'
    : 'This rail reads this deployment\'s database and no other. There is no cross-branch read behind it, '
      + 'so a question about another territory is one it cannot ask rather than one it declines.';
  return (
    <div
      className="lg:grid lg:items-start lg:gap-6"
      style={{ gridTemplateColumns: 'minmax(0,1fr) var(--fwr-track, 280px)' }}
      data-testid="branch-zone"
    >
      <div className="min-w-0">{children}</div>
      <div className="mt-4 lg:mt-0">
        <div className="lg:sticky lg:top-20">
          <WorkerRail
            workspace={workspace}
            role="branch_admin"
            stance={stance}
            note={note}
            coverage={coverage}
            coverageNote={coverageNote}
            unavailable={unavailable}
            data-testid="branch-rail"
          />
        </div>
      </div>
    </div>
  );
}
