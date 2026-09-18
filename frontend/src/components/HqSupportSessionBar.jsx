// D142 / S13 — what the branch sees while HQ is inside its account.
//
// WHAT WAS THERE BEFORE, AND WHY IT WAS WORSE THAN NOTHING. `isImpersonating`
// is `!!realUser`, and `SupportRedeemPage` never writes `realUser` — it cannot,
// because the HQ operator is a row in HQ's database that this deployment cannot
// read at all. So during an HQ support session the branch rendered either
// NOTHING (a non-admin target) or, for an admin target, `PortalSwitcher`'s
// ordinary purple "Admin Mode" bar complete with a working View-as picker: an
// HQ-driven session dressed as the admin's own. This bar renders ABOVE that
// one, so the purple bar can never be the only chrome on a session the viewer
// did not start.
//
// WHY IT PERSISTS NOTHING, on `AdminFrozenBar`'s stated rule. A bar describing
// something being done TO you is not a bar you get to dismiss. There is no
// close button here at all — unlike the frozen bar, which announces a refusal
// that has already finished, this describes a thing that is still happening,
// and it stops on its own when the session does.
//
// THE COUNTDOWN IS HQ'S CLOCK, MIRRORED. It ticks off the stored `expires_at`,
// and when it runs out the bar goes — because the session goes: the JWT is
// minted for thirty minutes and `user_sessions.factor = 'hq_support'` fails
// TOTP-gated routes closed. It is not this component deciding anything.
//
// THE BRANCH CANNOT END IT, and the bar says so rather than offering a control
// that would refuse. The session is HQ's. What the branch can do is raise a
// concern, which is an escalation like any other (S9), so that is the one
// action offered.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye } from 'lucide-react';
import { activeSupportSession, timeLeftLabel } from '../lib/supportSession';

export default function HqSupportSessionBar() {
  const [session, setSession] = useState(() => activeSupportSession());

  useEffect(() => {
    // One second, because the thing on screen is a countdown. `active()` clears
    // the stored payload itself once it expires, so this also stops the browser
    // carrying a spent claim into the next session.
    const id = setInterval(() => setSession(activeSupportSession()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!session) return null;

  const left = timeLeftLabel(session.msLeft);

  return (
    <div
      data-testid="hq-support-session-bar"
      role="status"
      className="w-full border-b border-amber-300 bg-amber-50 px-4 py-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <Eye size={15} className="shrink-0" aria-hidden="true" />
        <span className="font-semibold">HQ support session</span>
        {/* Each field renders only when the redeem response carried it. A
            missing actor is stated by its absence rather than by inventing
            "someone at HQ", which would be this component asserting a fact the
            server did not send. */}
        {session.actorName && <span>· {session.actorName} (HQ) is viewing this branch</span>}
        {session.reason && <span className="italic">· “{session.reason}”</span>}
        {left && <span className="tabular-nums font-semibold">· {left}</span>}
        <span className="text-amber-800/80 dark:text-amber-300/80">
          · This session is HQ&rsquo;s and cannot be ended from here.
        </span>
        <Link
          to="/branch/approvals"
          className="font-medium underline underline-offset-2"
        >
          Raise a concern
        </Link>
      </div>
    </div>
  );
}
