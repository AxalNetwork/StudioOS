import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../ui';
import HeldZone from './HeldZone';
import { Figure, useHeldGlance } from './heldFigures';
import AdminPageHeader, { HeaderTab } from '../../ui/AdminPageHeader';
import { ACCOUNTS_LINE, ACCOUNTS_TABS, PROFILE_WIDGETS, widgetCount } from './accountsAddress';

/**
 * Admin · Accounts on HQ-held accounts — S20's row (D286).
 *
 * FOUR LITERAL LINKS, AND NO EMBED. S20 draws the row as "Users table →
 * /admin; Exploring board → /admin/exploring", and that is what this page
 * does: the Users table is the Admin Console's own panel, opened there, with
 * its counts, filters, drawer and View As — and its search caption reading
 * "Searching HQ-held accounts" (S0 wall rule 2). HQ · Team embeds that panel
 * (`hq/AccountsPage`), and an earlier draft of this page did too, until
 * `admin_route_reachability.test.mjs` refused it: a component mounted at a
 * second path has to be declared in that guard's `SECOND_MOUNTS`, which is
 * not this item's to edit. The link is what the artboard draws anyway.
 *
 * The other three: retagging one person's persona (S22: "the taxonomy itself
 * is HQ's", so this links the tab and does not draw the taxonomy), Trash
 * (D283 placed it on Accounts as the console's own header link; the card is
 * the row's door to it), and the Exploring board, also an Approvals lane.
 */
const OPEN = 'font-semibold text-axal-ink underline underline-offset-2';

const NOT_ON_GLANCE = 'Retagging is per person, and no count of it is on the Studio glance.';

/** D1299: ACC1's totals row, from the same glance; a figure the glance lacks says so. */
function AccountsTotals({ glance, acc }) {
  const ready = acc?.kind === 'ready';
  const v = (x) => (ready ? x : acc?.kind === 'unreadable' ? null : undefined);
  const tiles = [
    ['total', 'Active accounts', v(acc?.total)],
    ['new7d', 'New in 7 days', v(acc?.new7d)],
    ['new30d', 'New in 30 days', v(acc?.new30d)],
    ['deactivated', 'Deactivated', v(acc?.deactivated)],
  ];
  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="accounts-totals">
      {tiles.map(([k, label, value]) => (
        <li key={k}>
          <Card className="h-full p-4" data-testid={`accounts-total-${k}`}>
            <h3 className="font-mono text-[10.5px] uppercase tracking-[.07em] text-axal-muted">{label}</h3>
            <Figure state={glance} value={value} reason={acc?.reason} testId={`accounts-total-${k}-count`} />
          </Card>
        </li>
      ))}
    </ul>
  );
}

export default function HeldAccounts() {
  // D555: each card shows its number, from the same glance as the Studio overview.
  const glance = useHeldGlance();
  const acc = glance.hq?.accounts;
  const ready = acc?.kind === 'ready';
  const unreadAcc = acc?.kind === 'unreadable' ? null : undefined;
  return (
    <HeldZone
      workspace="Accounts"
      stance="Four consoles, each opened where it is decided"
      coverage={[ready ? `${acc.total.toLocaleString('en-US')} active HQ-held accounts, counted on the Studio glance` : 'Four account consoles on this page']}
      coverageNote="Counts are this database’s — the accounts HQ holds on axal.vc — and live in the Users table. No branch figure appears."
      unavailable={[
        ['A tenant per account', 'No ordinary account names a licence (U1), so there is no Branch column to read.'],
        ['The persona taxonomy', 'The taxonomy is HQ’s (Content · Personas); this row retags one person.'],
      ]}
    >
      {/* D1299 (#2377): the Accounts canvas's header and tabs (ACC1, ACC2). */}
      <AdminPageHeader
        title="Accounts"
        line={ACCOUNTS_LINE}
        tabs={ACCOUNTS_TABS.map((t) => (
          <HeaderTab key={t.key} to={t.to} data-testid={`accounts-tab-${t.key}`}>{t.label}</HeaderTab>
        ))}
        data-testid="accounts-header"
      />
      <AccountsTotals glance={glance} acc={acc} />
      <h2 className="mt-5 text-[13px] font-extrabold tracking-tight text-axal-ink">By profile</h2>
      <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="accounts-profile-widgets">
        {PROFILE_WIDGETS.map((w) => (
          <li key={w.key}>
            <Card className="h-full p-4" data-testid={`accounts-widget-${w.key}`}>
              <h3 className="text-[13px] font-extrabold tracking-tight text-axal-ink">{w.label}</h3>
              <Figure state={glance} value={w.role ? (ready ? widgetCount(acc.byRole, w.role) : unreadAcc) : undefined} unit="active" reason={w.role ? acc?.reason : w.reason} testId={`accounts-widget-${w.key}-count`} />
            </Card>
          </li>
        ))}
      </ul>
      <h2 className="mt-5 text-[13px] font-extrabold tracking-tight text-axal-ink">Also in Accounts</h2>
      <ul className="mt-2 grid gap-3 sm:grid-cols-2" data-testid="held-accounts-cards">
        <li>
          <Card className="h-full p-4" data-testid="held-accounts-users">
            <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">Users table</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-axal-muted">
              The directory: counts by role, filters, the detail drawer and View As. Search there says what it
              searches — HQ-held accounts.
            </p>
            <Figure state={glance} value={ready ? acc.total : unreadAcc} unit="active accounts" reason={acc?.reason} testId="held-accounts-users-count">
              {ready && acc.byRole.length ? <span className="text-axal-muted"> · {acc.byRole.map((r) => `${r.count.toLocaleString('en-US')} ${r.role}`).join(' · ')}</span> : null}
            </Figure>
            <p className="mt-2 text-[11.5px]"><Link to="/admin/accounts/all" className={OPEN}>Open the Users table</Link></p>
          </Card>
        </li>
        <li>
          <Card className="h-full p-4" data-testid="held-accounts-exploring">
            <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">Exploring board</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-axal-muted">
              Chat-onboarded people awaiting a binding agreement and a role. Also an Approvals lane.
            </p>
            <Figure state={glance} value={ready ? acc.exploring : unreadAcc} unit="exploring" reason={acc?.reason || 'The Exploring lane could not be read.'} testId="held-accounts-exploring-count" />
            <p className="mt-2 text-[11.5px]"><Link to="/admin/exploring" className={OPEN}>Open the Exploring board</Link></p>
          </Card>
        </li>
        <li>
          <Card className="h-full p-4" data-testid="held-accounts-personas">
            <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">Retag a persona</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-axal-muted">
              Retags one person’s persona; the taxonomy itself is HQ’s.
            </p>
            <Figure state={glance} value={undefined} reason={NOT_ON_GLANCE} testId="held-accounts-personas-count" />
            <p className="mt-2 text-[11.5px]"><Link to="/admin/persona-segments" className={OPEN}>Open Persona segments</Link></p>
          </Card>
        </li>
        <li>
          <Card className="h-full p-4" data-testid="held-accounts-trash">
            <h2 className="text-[13px] font-extrabold tracking-tight text-axal-ink">Trash</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-axal-muted">
              Soft-deleted projects, with a hard-delete that does not come back.
            </p>
            <Figure state={glance} value={ready ? acc.trash : unreadAcc} unit="projects in Trash" reason={acc?.reason || 'The project table could not be read.'} testId="held-accounts-trash-count" />
            <p className="mt-2 text-[11.5px]"><Link to="/admin/trash" className={OPEN}>Open trash</Link></p>
          </Card>
        </li>
      </ul>
    </HeldZone>
  );
}
