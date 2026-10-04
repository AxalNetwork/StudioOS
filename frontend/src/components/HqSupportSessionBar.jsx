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
//
// THE CONCERN ARRIVES FILLED IN (D525). Since D445 the Approvals page reads
// `?kind=` and `?subject=` and every Settings door passes them; this link
// passed nothing, so the person had to retype what the bar had just told
// them. The link is built with `approvalsHref`, the one helper the other doors
// use, so the encoding and the 300-character cut are the page's own. The kind
// is `other`: a concern about an HQ session is none of moderation, content or
// seats. The subject names the session, the HQ actor and the reason — each
// only when the redeem response carried it, the same rule the fields above
// follow, so a missing actor is absent rather than "someone at HQ".
//
// AND IT ARRIVES FILLED IN FROM THE APPROVALS PAGE TOO. This bar is global
// chrome, so it is still drawn on /branch/approvals, and from there the link
// changes only the query string: React Router keeps the same BranchApprovals
// instance, which copies `?kind=` and `?subject=` into state once, in its
// `useState` initialisers, so a client-side navigation left the form as it
// was (Codex's finding on #1044). From that one page the link therefore
// reloads the document, which is the one way this file can force a fresh
// form state without editing BranchApprovals.jsx (slot S06's file). The
// proper fix — the page re-reading its query when it changes — is relayed on
// #1031; once it lands, `reloadDocument` here is the line to drop.
import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Eye } from 'lucide-react';
import { activeSupportSession, timeLeftLabel } from '../lib/supportSession';
import { approvalsHref } from '../lib/escalationPrefill';

/** "HQ support session[ by <actor>][: <reason>]" — only what the session carries. */
export function concernSubject(session) {
  const parts = ['HQ support session'];
  if (session.actorName) parts.push(`by ${session.actorName}`);
  const head = parts.join(' ');
  return session.reason ? `${head}: ${session.reason}` : head;
}

/** The one page where a client-side navigation to the link would change nothing. */
export const APPROVALS_PATH = '/branch/approvals';

export default function HqSupportSessionBar() {
  const [session, setSession] = useState(() => activeSupportSession());
  const onApprovals = useLocation().pathname === APPROVALS_PATH;

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
          to={approvalsHref({ kind: 'other', subject: concernSubject(session) })}
          reloadDocument={onApprovals}
          className="font-medium underline underline-offset-2"
        >
          Raise a concern
        </Link>
      </div>
    </div>
  );
}
