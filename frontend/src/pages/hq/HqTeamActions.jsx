import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, ListChecks } from 'lucide-react';
import { Card } from '../../ui';

/**
 * H20's two action cards — "HQ-only actions" and "Admin's actions" (D221).
 *
 * WHAT THE CANVAS DRAWS AND WHAT IS TRUE, CARD BY CARD. H20 names five powers
 * only HQ may take and four that belong to an admin, each with a one-line note.
 * The NAMES are the canvas's, verbatim. The NOTES are not: every one was read
 * against the route that performs the act, and several describe a platform that
 * does not exist — "banner both sides see" (the target sees no banner; since
 * D248 they are told by a notice, which is not a banner), "Lands on Programs as well" (it does not), "Within the licence's seats
 * only" (no grant is checked against a seat count), "The decision happens on
 * Approvals" (Approvals decides nothing). A card that repeated those would be
 * the first place an operator learned something false about their own powers,
 * so each row says instead what gates the act, where it is done, and whether
 * Security records it.
 *
 * ONE CANVAS NOTE WAS FALSE AND IS NOW TRUE. "Both parties notified" described
 * a transfer that told nobody, and this card said so until D241 made the route
 * tell the successor and the former holder. The transfer row now says what the
 * route does, and the test that held it false now holds it true — against the
 * route's own two notices, so the sentence cannot outlive them.
 *
 * ONE OF THIS CARD'S OWN NOTES WAS TRUE AND WEAK, AND IS NOW STRONGER. The
 * Deactivate note said the Super Admin could close an administrator's account
 * with no authenticator, step-up or reason asked — accurately, until D247 gave
 * the act demote's bar. The note says what the route now requires, and the
 * test reads the route for the three checks so the sentence cannot outlive them.
 *
 * AND ONE MORE CHANGED WITH ITS ROUTE: the role override said "No authenticator
 * or step-up is asked", which was true until D249 gave it demote's bar. The
 * note now names the bar, and says the person is told and what the override
 * does and does not start.
 *
 * ONE ROW IS NOT HQ'S, AND IT SAYS SO RATHER THAN MOVING. "View as a role shell"
 * is offered to every admin — HQ, the holder and a branch admin alike — by the
 * shell's own picker, and it changes nothing but this browser's chrome. The
 * canvas files it under HQ-only; it stays in the card the canvas drew it in,
 * because that is where an operator will look for it, and it carries the fact.
 *
 * UNDER THE OVERLAY THE HQ-ONLY CARD IS ABSENT, as H20 draws it ("the HQ-only
 * card hides"), and D153's rule governs the rest: HQ is reading one branch, so
 * nothing here can be acted on and no control is drawn. What H20 says happens
 * next — "these four become the row actions" — is refused with its reason: a
 * branch account search returns a role and an active state, not KYC, access
 * or Lab state, so there are no row actions a branch's answer could carry.
 *
 * LINKS ARE LITERAL AND GO ONLY TO REGISTERED ROUTES. Every `to` below is a
 * string a reachability test can read, and none is a route that would 404 or
 * silently redirect.
 */

/**
 * D248 — how long a support session may last in all, extensions included, in
 * hours. The worker's `IMPERSONATION_CEILING_MINUTES` (cloudflare-worker/src/
 * auth.ts) is the one that is enforced; the SPA cannot import worker code, so
 * this states it and hq_team_h20.test.mjs holds the two equal.
 */
export const SUPPORT_SESSION_CEILING_HOURS = 2;

/** The five H20 draws under "HQ-only actions". `hq: false` marks the one that is not. */
export const HQ_ONLY_ACTIONS = [
  {
    key: 'impersonate',
    name: 'Impersonate — including other admins',
    hq: true,
    gate: `A typed reason of at least 10 characters, your authenticator and a fresh step-up. The session lasts 30 minutes; Extend adds 30 more for a new reason, up to ${SUPPORT_SESSION_CEILING_HOURS} hours from when it opened, and not in the day after an account recovery. Opening one as another admin is the Super Admin’s alone — as anyone else, it is every admin’s power. The person is told when it opens, in the app and by email, with your name and your reason; there is no banner on their side.`,
    where: 'View As on an admin’s row in the directory below.',
    recorded: 'Yes — the session, its reason and when it ended, under Impersonations; each extension, with its reason, in the audit log.',
  },
  {
    key: 'role_shell',
    name: 'View as a role shell',
    hq: false,
    gate: 'Not HQ’s alone: every admin is offered it, a branch admin included. It swaps the sidebar and chrome in this browser only — every write still goes out as you.',
    where: 'The View as picker in the top bar.',
    recorded: 'No — nothing leaves the browser, so there is nothing to record.',
  },
  {
    key: 'demote_deactivate',
    name: 'Demote or deactivate an Admin',
    hq: true,
    gate: 'Demote: your authenticator, a fresh step-up and a typed reason. Deactivate: the Super Admin alone, with the same three — your authenticator, a fresh step-up and a typed reason of at least 10 characters — and re-opening the account asks for them again. Neither reaches an admin whose account lives on a branch database.',
    where: 'Demote on the licence’s Administrators tab; deactivate with Disable on the directory below.',
    link: 'licences',
    recorded: 'Yes — a demotion as a role change; a deactivation as a suspension, and in the audit log with the account and the reason.',
  },
  {
    key: 'transfer',
    name: 'Transfer the Super Admin elevation',
    hq: true,
    gate: 'The Super Admin alone: authenticator, fresh step-up and a typed reason of at least 10 characters, in one step, to an administrator whose account is active. The successor and the former holder are both notified, in the app and by email.',
    where: 'The holder console at the top of this page.',
    recorded: 'Yes — who received it, who gave it up, and the reason.',
  },
  {
    key: 'role_override',
    name: 'Role override on a binding agreement',
    hq: true,
    gate: 'The Super Admin alone: your authenticator, a fresh step-up and a typed reason of at least 10 characters. Only a change out of Exploring is an override, and the person’s own activity says it was one, and why. A founder or investor starts their onboarding; the Spin-Out Lab is left to the Exploring queue.',
    where: 'The Role picker on an Exploring account’s row in the directory below.',
    recorded: 'Yes — as a role change carrying the reason, and in the audit log as an override naming the person.',
  },
];

/** The four H20 draws under "Admin's actions". Every admin has them, HQ included. */
export const ADMIN_ACTIONS = [
  {
    key: 'admit_lab',
    name: 'Admit to Lab',
    gate: 'Marks the account admitted to the Spin-Out Lab and emails them. It does not place them in a cohort on Programs.',
    recorded: 'In the activity log only — not in Security.',
  },
  {
    key: 'grant_access',
    name: 'Grant Access / Grant Limited',
    gate: 'Grant Access marks KYC approved without a submission; Grant Limited lets the account browse but not sign. Neither is checked against the licence’s seats — no grant on the platform is.',
    recorded: 'Grant Access is in Security; Grant Limited is in the activity log only.',
  },
  {
    key: 'kyc_decide',
    name: 'KYC decide',
    gate: 'Approve or reject on the Admin Console’s KYC queue, or approve through Grant Access. Approvals shows the outcome and offers no decision.',
    link: 'kyc',
    recorded: 'Yes — both approvals and rejections.',
  },
  {
    key: 'disable',
    name: 'Disable a non-admin in territory',
    gate: 'Reversible by the same toggle. The directory below is HQ\u2019s own database, so on HQ the territory is every account in it; a branch disables its own.',
    recorded: 'Yes — as a suspension.',
  },
];

/** Literal routes, so the reachability walk can read every one. */
const LINKS = {
  licences: <Link to="/admin/licences" className="font-semibold text-axal-ink underline">Licences &rarr;</Link>,
  kyc: <Link to="/admin?tab=kyc" className="font-semibold text-axal-ink underline">KYC queue &rarr;</Link>,
};

function ActionRow({ a, tone }) {
  return (
    <li
      className={`flex items-start gap-2.5 rounded-lg px-3 py-2 ${tone === 'hq'
        ? 'border border-axal-hairline bg-axal-hairline/20'
        : 'border border-dashed border-axal-hairline'}`}
      data-testid={`hq-team-action-${a.key}`}
    >
      <span
        aria-hidden="true"
        className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${a.hq === false
          ? 'bg-gray-400 dark:bg-gray-500'
          : tone === 'hq' ? 'bg-rose-700 dark:bg-rose-400' : 'bg-slate-400 dark:bg-slate-500'}`}
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[12.5px] font-bold text-axal-ink">{a.name}</span>
          {a.hq === false && (
            <span className="rounded border border-axal-hairline px-1.5 py-px text-[10px] font-bold uppercase tracking-[.06em] text-axal-faint" data-testid="hq-team-action-not-hq">
              Every admin&rsquo;s
            </span>
          )}
        </div>
        <p className="mt-1 text-[11.5px] leading-relaxed text-axal-muted">{a.gate}</p>
        {a.where && <p className="mt-1 text-[11.5px] leading-relaxed text-axal-muted">Where: {a.where}</p>}
        <p className="mt-1 text-[11px] leading-relaxed text-axal-faint">
          In Security: {a.recorded}
          {a.link && LINKS[a.link] && <>{' '}{LINKS[a.link]}</>}
        </p>
      </div>
    </li>
  );
}

/**
 * Pure: the whole card pair is a function of the overlay scope, so a test can
 * render both states without a router session or a fetch.
 */
export default function HqTeamActions({ viewAs = null }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="hq-team-actions">
      {!viewAs && (
        <Card className="p-5" data-testid="hq-team-actions-hq">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
              <ShieldAlert size={13} /> HQ-only actions
            </div>
            <Link to="/admin/security" className="text-[11px] font-semibold text-axal-ink underline" data-testid="hq-team-actions-security">
              Recorded in Security &rarr;
            </Link>
          </div>
          <ul className="mt-3 grid gap-2">
            {HQ_ONLY_ACTIONS.map((a) => <ActionRow key={a.key} a={a} tone="hq" />)}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-axal-faint">
            Four of these five are the Super Admin&rsquo;s alone; the role shell is every admin&rsquo;s and
            is marked so. Where a row says Security records an act, it is in the feed on the Security page;
            where it says not, the act leaves no row there.
          </p>
        </Card>
      )}

      <Card className="p-5" data-testid="hq-team-actions-admin">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
            <ListChecks size={13} /> Admin&rsquo;s actions
          </div>
          <span className="text-[11px] text-axal-faint">Read-only here</span>
        </div>
        <ul className="mt-3 grid gap-2">
          {ADMIN_ACTIONS.map((a) => <ActionRow key={a.key} a={a} tone="admin" />)}
        </ul>
        <p className="mt-3 text-[11px] leading-relaxed text-axal-faint" data-testid="hq-team-actions-admin-note">
          {viewAs
            ? `These are ${viewAs}'s own, on its Admin Console. From here they are not drawn as row actions: HQ is reading ${viewAs}'s answer, and a branch account search returns a role and an active state — not KYC, access or Lab state — so there is nothing a row could act on.`
            : 'Every admin has these four, HQ included — on the Admin Console’s Users table and on the directory below. On a branch they are the branch admin’s, on its own Admin Console.'}
        </p>
      </Card>
    </div>
  );
}
