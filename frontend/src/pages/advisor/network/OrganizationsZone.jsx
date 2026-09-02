import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../../ui';

/**
 * Network · Organizations — an honest card, and the reason it is one.
 *
 * The canvas asks for companies, funds and studios "rolled up from the people
 * you know inside them", with referral credit attributed at the organization
 * level so a studio that sent four clients reads as a channel rather than four
 * unconnected names. Every word of that depends on ONE edge: person → org.
 *
 * That edge exists in exactly one place and an advisor cannot reach it. The
 * founder version of this zone reads `contacts.organization`, and `/api/contacts`
 * is `requireRole(c, 'founder')` — `'advisor'` is not even a member of that
 * guard's parameter type, so the role is unrepresentable in it rather than
 * merely excluded. The relationship store holds account-id pairs with no
 * organisation column; the referral store holds an organisation NAME as free
 * text with no link to anything.
 *
 * `GET /api/companies` would return rows an advisor may read, and pointing this
 * zone at it is exactly what must not happen: it is a global directory of
 * self-registered profiles with no connection to the reader, so it would answer
 * "which organisations do I know?" with "here are all of them". That trades a
 * blank surface for a misleading one — the reasoning D12 gave for removing the
 * withdrawn Research tabs rather than redirecting them at the nearest page.
 */
export default function OrganizationsZone() {
  return (
    <Card variant="dashed" padding="lg">
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
        No store behind this yet
      </div>
      <h2 className="mt-2 text-lg font-extrabold tracking-tight">
        Nothing links a person you know to the organisation they are in
      </h2>
      <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-axal-ink-2">
        This zone would roll your book up by company, fund and studio, and attribute referral credit
        at that level so a studio that sent you four clients reads as one channel. It needs an edge
        from a person to an organisation, and for an advisor there is none: relationships are stored
        as pairs of account ids with no organisation on them, and a referral records the
        organisation as text you typed rather than a link to anything.
      </p>
      <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-axal-ink-2">
        The founder version of this page gets that edge from the contacts book, which is closed to
        advisors at the API — not merely unlisted, but outside what that endpoint&rsquo;s guard can
        express. A company directory does exist and you may read it, but it lists every
        self-registered profile on the platform with no connection to you, so pointing this page at
        it would answer &ldquo;which organisations do I know?&rdquo; with &ldquo;all of them&rdquo;.
      </p>
      <p className="mt-3 text-[12px]">
        <Link to="/network/relationships" className="text-emerald-700 underline">
          The people themselves are in your book &rarr;
        </Link>
      </p>
    </Card>
  );
}
