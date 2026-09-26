/**
 * The cards under Eadwyn on Admin Studio. One per other Admin page.
 * Figures come from reads the branch pages already make. This file does not
 * mount a second assistant.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { branchLabel } from '../../lib/shellRole';
import { titleCase, Card, Unrecorded, Unreadable } from '../../ui';
import { COMMUNITY_CONSOLES } from '../branch/BranchCommunity';
import { freezeLine, studioGlances } from './adminStudioOverview';

function Glance({ glance }) {
  if (!glance) return <p className="mt-2 text-[12px] text-axal-muted">Reading…</p>;
  if (glance.kind === 'unreadable') {
    return (
      <div className="mt-2">
        <Unreadable what="This" claim={glance.reason || 'The read did not complete.'} />
      </div>
    );
  }
  if (glance.kind === 'unrecorded') {
    return (
      <p className="mt-2 text-[13px] text-axal-ink">
        <Unrecorded reason={glance.reason} />
      </p>
    );
  }
  if (glance.kind === 'empty' || glance.kind === 'ready') {
    return <p className="mt-2 text-[13px] leading-relaxed text-axal-ink">{glance.text}</p>;
  }
  return null;
}

function CardHead({ title, to }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-[14px] font-extrabold tracking-tight text-axal-ink">{title}</h2>
      <Link to={to} className="text-[12px] font-semibold text-axal-ink underline underline-offset-2">
        Open
      </Link>
    </div>
  );
}

export function AdminStudioOverview({ user, home, licence, templates, insights }) {
  // D246 — every figure comes from studioGlances, which the needs-a-decision
  // strip reads too, and a prop equal to the shared UNAVAILABLE sentinel
  // renders as Unreadable.
  const {
    onBranch, lic, seats, approvals, programme, contracts, insights: insightView,
  } = studioGlances({ user, home, licence, templates, insights });

  const territories = Array.isArray(user?.branch?.territories) ? user.branch.territories.filter(Boolean) : [];
  const status = user?.branch?.status;
  const statusWord = status === 'active' ? 'Active' : status === 'suspended' ? 'Suspended' : 'Awaiting HQ';
  const suspendedAt = lic?.suspended_at || null;

  return (
    <div data-testid="admin-studio-overview">
      {onBranch && status === 'suspended' ? (
        <p
          data-testid="admin-studio-frozen"
          className="mt-4 rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2 text-[13px] text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200"
        >
          {freezeLine(branchLabel(user), suspendedAt)}
        </p>
      ) : null}

      {onBranch ? (
        <p className="mt-4 text-[12.5px] text-axal-muted" data-testid="admin-studio-territory">
          <span className="font-semibold text-axal-ink">{branchLabel(user) || 'This territory'}</span>
          {territories.length ? ` · ${territories.join(' · ')}` : ''}
          {` · ${statusWord}`}
        </p>
      ) : (
        <p className="mt-4 text-[12.5px] text-axal-muted" data-testid="admin-studio-no-branch">
          This account is not on a branch deployment. The cards below say what is not recorded here.
        </p>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card data-testid="admin-studio-accounts">
          <CardHead title="Accounts" to="/branch/accounts" />
          {seats === null ? <p className="mt-2 text-[12px] text-axal-muted">Reading seats…</p> : null}
          {seats && seats.kind !== 'ready' ? <Glance glance={seats} /> : null}
          {seats?.kind === 'ready' ? (
            <ul className="mt-2 space-y-1 text-[13px] text-axal-ink">
              {seats.lines.tiles.map((t) => (
                <li key={t.type}>
                  {t.missing ? (
                    <Unrecorded reason="This seat type was not on the copy, so it is not shown as zero.">
                      {titleCase(t.type)}
                    </Unrecorded>
                  ) : t.state === 'unlicensed' ? (
                    <>
                      <span className="font-semibold">{titleCase(t.type)}</span>
                      {' · no seats of this type licensed'}
                    </>
                  ) : (
                    <>
                      <span className="font-semibold">{titleCase(t.type)}</span>
                      {' '}
                      <span className="tabular-nums">{t.used} of {t.licensed}</span>
                      {t.state === 'over' ? ' · over' : ''}
                      {t.type === seats.lines.tightestType ? ' · tightest' : ''}
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card data-testid="admin-studio-approvals">
          <CardHead title="Approvals" to="/branch/approvals" />
          <Glance glance={approvals} />
        </Card>

        <Card data-testid="admin-studio-programs">
          <CardHead title="Programs" to="/branch/programs" />
          <Glance glance={programme} />
          <p className="mt-2 text-[11.5px] text-axal-muted">Week dates are set at HQ. This page reads them.</p>
        </Card>

        <Card data-testid="admin-studio-community">
          <CardHead title="Community" to="/branch/community" />
          <ul className="mt-2 space-y-1.5">
            {COMMUNITY_CONSOLES.map((c) => (
              <li key={c.key} className="text-[13px]">
                <Link to={c.to} className="font-semibold text-axal-ink underline underline-offset-2">{c.label}</Link>
                <span className="text-axal-muted"> · {c.scope}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card data-testid="admin-studio-contracts">
          <CardHead title="Contracts" to="/branch/contracts" />
          {contracts === null ? <p className="mt-2 text-[12px] text-axal-muted">Reading the library and agreements…</p> : (
            <>
              <Glance glance={contracts} />
              <div data-testid="admin-studio-agreements">
                <Glance glance={contracts.agreements} />
                {/* Only beside a MEASURED answer. Qualifying a count that was
                    never taken would dress an absence as a partial result. */}
                {contracts.agreements?.note
                  && (contracts.agreements.kind === 'ready' || contracts.agreements.kind === 'empty') ? (
                    <p className="mt-1 text-[11px] leading-relaxed text-axal-muted">{contracts.agreements.note}</p>
                  ) : null}
              </div>
            </>
          )}
        </Card>

        <Card data-testid="admin-studio-insights">
          <CardHead title="Insights" to="/branch/insights" />
          {insightView === null ? <p className="mt-2 text-[12px] text-axal-muted">Reading insights…</p> : (
            <>
              <Glance glance={insightView.median} />
              <Glance glance={insightView.share} />
            </>
          )}
        </Card>

        <Card data-testid="admin-studio-settings" className="lg:col-span-2">
          <CardHead title="Settings" to="/branch/settings" />
          {/* D197 — THE TYPED COUNT IS GONE, and that is the whole correction
              here. This card said "4 of 5 rows owned by HQ." in a second
              spelling of a number `BranchSettings` states in a third; the
              branch page now DERIVES it from its own rows, and this card
              cannot derive anything — it has no read of them. A number it
              cannot compute is a number that goes stale the next time a row
              lands, which is exactly what happened. The link is what it has,
              and the link goes to the page that counts. */}
          <p className="mt-2 text-[13px] leading-relaxed text-axal-ink">
            Every row on Settings names who decides it, and the count of HQ-owned rows is derived
            there rather than stated here.
            {' '}
            {!lic ? (
              // THE LICENCE WAS NOT READ, which is a different claim from "no
              // host is bound" — the register was never consulted. The card
              // already draws that distinction for seats a dozen lines up, and
              // a host is no less worth it.
              <Unrecorded reason="The licence was not read, so whether a custom host is bound is unknown rather than none.">
                Hostname not read
              </Unrecorded>
            ) : lic.domain_available === false ? (
              <Unrecorded reason={lic.domain_reason}>Hostname not readable</Unrecorded>
            ) : lic.domain ? (
              // A BOUND HOST IS NAMED WITH ITS STATE AND NEVER WITHOUT IT:
              // `verified` is not serving, and a hostname printed bare would
              // read as the host members are on.
              <span data-testid="studio-hostname">
                Hostname <b>{lic.domain.hostname}</b> · {lic.domain.state}
              </span>
            ) : (
              <Unrecorded reason="The host register was read and this licence has bound no custom host. The Admin binds one in Settings → Domain; Super Admin does not add one, and this card does not offer a form.">
                No hostname bound
              </Unrecorded>
            )}
            {' · '}
            {/* D198 — THE FIFTH STALE REFUSAL THIS PROGRAMME HAS HAD TO
                CORRECT, and it read "Mark, colours and the powered-by line have
                no store yet". Migration 281 gave the mark and the colours one;
                the powered-by line still has none, and that half stays true
                because nothing in the shell renders a platform credit at all.
                The three states mirror the hostname block above them for the
                same reason they exist there: unread, unreadable and absent are
                three different claims. The fourth — "a kit does not apply" — is
                new here, because only a white-label licence has one. */}
            {!lic ? (
              <Unrecorded reason="The licence was not read, so whether a brand kit is recorded is unknown rather than none.">
                Brand kit not read
              </Unrecorded>
            ) : lic.kind !== 'white_label' ? (
              <Unrecorded reason="This is an Axal subsidiary, so it trades under Axal’s brand. That brand is fixed and is not stored per licence — only a white-label has a kit of its own.">
                Brand kit not applicable
              </Unrecorded>
            ) : lic.brand_kit_available === false ? (
              <Unrecorded reason={lic.brand_kit_reason}>Brand kit not readable</Unrecorded>
            ) : lic.brand_kit?.primary_hex ? (
              <span data-testid="studio-brand-kit">
                Brand kit <b>{lic.brand_kit.primary_hex}</b>
                {lic.brand_kit.accent_hex ? ` · ${lic.brand_kit.accent_hex}` : ''}
                {lic.brand_kit.mark_url ? ' · mark uploaded' : ' · no mark'}
              </span>
            ) : (
              <Unrecorded reason="The brand-kit store was read and this white-label licence has no colours set. Super Admin captures them on the licence’s Brand kit tab; this card does not offer a form.">
                Brand kit not recorded
              </Unrecorded>
            )}
          </p>
        </Card>
      </div>
    </div>
  );
}
