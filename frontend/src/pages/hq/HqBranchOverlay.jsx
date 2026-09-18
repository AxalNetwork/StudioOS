// HQ · Home, read through ONE branch (Admin · Super canvas, H12, frame 1).
//
// WHAT THIS IS, IN THE CANVAS'S OWN WORDS: "The overlay is not a filter on an
// HQ table — it is one private-link read, of one branch, rendered with every
// action removed. Each figure carries the branch and the time it was read, so
// nothing on the screen can be mistaken for a platform total."
//
// So this is a SEPARATE BODY rather than HqHomePage with a predicate over it,
// and that is the point rather than a convenience. HQ's own page draws a
// licence ledger, a platform account total, a ticket queue and a licensing
// feed; none of those is a branch's, and a version of that page with some
// figures swapped would leave the rest reading as the branch's. The route it
// reads is scoped too (`hqOverview(branch)` → `?branch=`), so the read HQ
// performed is exactly what the bar above claims it performed.
//
// EVERY ACTION IS ABSENT, NOT DISABLED. The canvas: "no approve, decline or
// reassign — the controls are absent, not disabled". A greyed control claims
// the action exists here and is momentarily unavailable; it does not exist
// here. HQ's writes against a branch are their own audited routes on their own
// screens, and D134 already recorded why a button that can only refuse is the
// wrong thing to draw.
//
// FOUR TILES, AND ONE OF THEM IS NULL BY CONSTRUCTION. `branchOverview`
// returns `revenue_mtd_cents: null` with its own `revenue_reason` — no branch
// has reported a figure (D111 built the call; nobody has used it) — so that
// tile renders the server's sentence rather than a zero. The canvas draws a
// number there; the branch does not have one, and D129's rule applies: draw
// the absence, never the sample.
import React, { useCallback, useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, Unrecorded, Unreadable } from '../../ui';

const UNAVAILABLE = Symbol('unavailable');
const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v).toLocaleString());
const stamp = (v) => (v ? String(v).replace('T', ' ').slice(0, 19) : null);

/**
 * One figure, with the branch and the moment it was read attached to it.
 *
 * THE STAMP IS NOT DECORATION. It is the single thing that stops a number on
 * this screen being read as a platform total, which is the failure the whole
 * overlay exists to prevent — so it is rendered per tile rather than once in a
 * header a reader can scroll past.
 */
function BranchTile({ label, value, reason, branch, readAt }) {
  return (
    <Card>
      <div className="text-[9.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{label}</div>
      <div className="mt-1.5 text-xl font-extrabold tracking-tight tabular-nums text-axal-ink">
        {value ?? <Unrecorded reason={reason} />}
      </div>
      <div className="mt-1 text-[10.5px] text-axal-faint" data-testid="hq-overlay-stamp">
        {branch}
        {' · read '}
        {readAt || 'at an unrecorded time'}
      </div>
    </Card>
  );
}

export default function HqBranchOverlay({ branch }) {
  const [data, setData] = useState(null);

  const load = useCallback(() => {
    setData(null);
    api.hqOverview(branch).then(setData, (e) => { reportError('hq-branch-overlay', e); setData(UNAVAILABLE); });
  }, [branch]);
  useEffect(() => { load(); }, [load]);

  const ready = data && data !== UNAVAILABLE;
  const scope = ready ? data.scope || null : null;
  const one = ready ? (data.branches || [])[0] || null : null;
  const live = one && one.status === 'ok' ? one.data || null : null;
  const readAt = stamp(scope?.read_at);
  const code = scope?.branch || branch;
  // The branch's own clock, which is a different question from HQ's: when the
  // figure left the branch, rather than when this screen was filled.
  const asOf = stamp(scope?.as_of);
  // The three states D108 defined, kept apart here for the reason they are
  // kept apart everywhere else: a branch that did not answer is not a branch
  // with nothing in it, and neither is a branch HQ holds no binding to.
  const absent = one && one.status !== 'ok'
    ? (one.reason || 'This branch could not be read, so nothing below is a figure.')
    : null;

  return (
    <div data-testid="hq-branch-overlay" data-branch={code} data-branch-state={one ? one.status : 'loading'}>
      <header>
        <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
          <Eye size={13} /> HQ · Viewing as {code}
        </div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink">{code}</h1>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
          One read of one branch, over its private link. Nothing on this screen is a platform total, and
          nothing on it can be acted on from here — every control this branch's own operators have is on
          their deployment, not in HQ&rsquo;s copy of their figures.
          {asOf ? ` The branch stamped its answer ${asOf}.` : ''}
        </p>
      </header>

      {data === UNAVAILABLE && (
        <div className="mt-4">
          <Unreadable what="This branch's overview" claim="This is not a claim that the branch is down." onRetry={load} />
        </div>
      )}

      {absent && (
        <div className="mt-4" data-testid="hq-overlay-branch-absent">
          <Card>
            <p className="text-[12.5px] leading-relaxed text-axal-muted">{absent}</p>
          </Card>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <BranchTile
          label="Accounts"
          value={live ? num(live.accounts?.total) : null}
          reason={absent || 'The branch answered without an account total.'}
          branch={code}
          readAt={readAt}
        />
        <BranchTile
          label="Seats used"
          value={live ? num(live.seats_used) : null}
          // D127 — seats used is counted from `users.role` and the branch sends
          // the basis it counted on. Rendering the figure without it would make
          // a derived number look like a seat register.
          reason={absent || live?.seats_used_reason || 'The branch answered without a seat count.'}
          branch={code}
          readAt={readAt}
        />
        <BranchTile
          label="Queue backlog"
          value={live ? num(live.backlog) : null}
          reason={absent || live?.backlog_reason || 'The branch answered without a backlog.'}
          branch={code}
          readAt={readAt}
        />
        <BranchTile
          label="MTD revenue"
          // NULL BY CONSTRUCTION, and the server says why: `branchOverview`
          // returns `revenue_mtd_cents: null` with `revenue_reason` because no
          // branch has reported a figure yet. Rendering a zero here would be a
          // claim about this branch's trading that nothing measured.
          value={null}
          reason={absent || live?.revenue_reason || 'No revenue figure has been reported by this branch.'}
          branch={code}
          readAt={readAt}
        />
      </div>

      {/* H12 draws a "Queues · as the branch sees them" zone whose rows are
          decisions the branch already made ("approved by C. Moreau · 09:41").
          NOTHING RETURNS THAT. Measured rather than assumed: `HqEntrypoint`
          has twelve methods and `branchOps` fifteen exports, and none of them
          is a decision feed. So the heading is drawn and the absence is
          stated, which is what D140, D147 and D151 all did in the same
          position — a zone of invented rows would be the one thing this
          screen cannot survive. */}
      <Card className="mt-4">
        <h2 className="text-[14.5px] font-extrabold tracking-tight">Queues · as the branch sees them</h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-axal-muted" data-testid="hq-overlay-queues-absent">
          No branch RPC returns a decision feed, so what this branch decided — and who decided it — is
          visible on the branch and not from here. HQ can read this branch&rsquo;s backlog DEPTH, which is
          the tile above; the decisions behind it are its own record.
        </p>
      </Card>
    </div>
  );
}
