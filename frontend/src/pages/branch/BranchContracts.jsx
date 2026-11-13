import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Lock } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, Unrecorded, Unreadable } from '../../ui';
import BranchZone from './BranchZone';

/**
 * Branch · Contracts — canvas S5 + S10, the half of it that has a source.
 *
 * WHAT THE NOTICE THIS REPLACES PROMISED, AND WHICH PART SURVIVED. It said:
 * *"Active contracts with the template version travelling on the row, HQ's
 * master library read-only with its as-of stamp and archived versions visible
 * but unusable, and pending signatures."* Measured, the library half is now
 * real — `publishTemplate` (D147) gives a branch its copy — and the ledger
 * is the same deployment's own rows, read from the list that already existed
 * (D444). Pending signatures are that list's stats. The template version a
 * row was sent from, and its value, are not on that list, so those cells
 * stay Not recorded rather than borrowed from the library copy or shown as
 * zero. End dates are (D474): pairwise NDAs by `valid_until`, partner deals
 * by `expires_at`. There is no renewal date separate from that expiry.
 *
 * THE WRONG TABLE WAS NAMED FIRST, and D199 corrects it. It said the
 * contracts live in `licence_contracts` (migration 259), HQ's table. That
 * table holds the LICENCE AGREEMENT between HQ and this licensee and nothing
 * else. This deployment's own contracts — e-sign envelopes, signed documents,
 * mutual NDAs and partner deals, the four sources `admin_contracts.ts`'s
 * `loadAllContracts` unions — are rows in THIS database (D.2), and
 * `GET /api/admin/contracts` is `requireAdmin`, not HQ-gated. The Studio
 * overview already counts the dated ones ending inside 60 days (D199). The
 * list now carries those end dates (D474). A row whose source records none
 * is not expiring, and the renewal cell says so.
 *
 * THE LIBRARY IS A COPY AND THE PAGE NEVER LETS YOU FORGET IT. Every field on
 * screen comes from `branch_templates`, which only HQ's push writes; the
 * `pushed_at` stamp is HQ's own, not this database's write time (migration
 * 256's rule), so the age shown is the age of the FACT and not of the row.
 *
 * THREE READ STATES, NOT TWO, AND THE MIDDLE ONE IS THE POINT.
 *   - unreadable      — migration 268 has not been applied. Nothing is known.
 *   - never pushed    — the table is there and HQ has not sent anything yet.
 *   - pushed, empty   — HQ sent a library and it was empty. A claim about HQ.
 * An empty list rendered for all three would be the same mistake D107 fixed on
 * the licence copy, where "you administer no licence" and "HQ has not pushed
 * yours" had been one sentence.
 *
 * THERE IS NO EDIT CONTROL, AND THE REFUSAL IS STATED RATHER THAN DISABLED.
 * D.9: HQ authors, branches read. `requireHqAuthoring` already refuses the
 * three store writes server-side; drawing a greyed pencil here would be the
 * `still_an_admin` mistake D134 named — a control that exists to be rejected
 * teaches the operator that some of its buttons are lies. The page says what
 * changing a template actually is: a Content submission to HQ.
 */

// THE LIST DOES NOT CARRY THESE. They are one sentence each, on the cell,
// because GET /api/admin/contracts has no field to put in them and a zero
// would be a value. The library's version is a different fact — HQ's current
// copy — and copying it onto a contract would claim the agreement was sent
// on that version.
export const VALUE_UNRECORDED =
  'None of the four sources behind GET /api/admin/contracts records a value, so this column is not shown as zero.';
export const RENEWAL_UNRECORDED =
  'E-sign envelopes and signed documents record no end date, so this row is not expiring.';
export const NDA_END_UNRECORDED =
  'This pairwise NDA stores no valid_until, so it is not expiring.';
export const DEAL_END_UNRECORDED =
  'This partner deal stores no expires_at. The list has no renewal date separate from that expiry, so it is not expiring.';
export const VERSION_UNRECORDED =
  'This list carries the template name and not the version the agreement was sent from. The version on the library above is the copy HQ last pushed, which is not this row\'s version.';

const DAY_MS = 86400000;
export const EXPIRING_WINDOW_DAYS = 90;

function calendarDay(value) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
  return m ? m[1] : null;
}

function readEnd(value, field, absentReason) {
  if (value == null || value === '') return { kind: 'none', reason: absentReason, field };
  const day = calendarDay(value);
  const ms = Date.parse(value);
  if (!day || !Number.isFinite(ms)) {
    return {
      kind: 'none',
      field,
      reason: `${field} is not a date this page can read, so this row is not expiring.`,
    };
  }
  return { kind: 'date', field, ms, day };
}

/** The end date the list actually carries, or why this row has none. */
export function endDateOf(row) {
  if (!row || typeof row !== 'object') return { kind: 'none', reason: RENEWAL_UNRECORDED };
  if (row.source === 'pairwise_nda') return readEnd(row.valid_until, 'valid_until', NDA_END_UNRECORDED);
  if (row.source === 'partner_deal') return readEnd(row.expires_at, 'expires_at', DEAL_END_UNRECORDED);
  return { kind: 'none', reason: RENEWAL_UNRECORDED };
}

/**
 * Rows whose end date falls in the next 90 days from `nowMs`.
 * A missing or unreadable end date is counted in `withoutEnd` and is not
 * treated as expiring. A date already past, or further out than the window,
 * is recorded and simply not in this strip.
 */
export function selectExpiring(rows, nowMs) {
  const now = nowMs;
  const horizon = now + EXPIRING_WINDOW_DAYS * DAY_MS;
  const expiring = [];
  let withoutEnd = 0;
  for (const row of rows) {
    const end = endDateOf(row);
    if (end.kind !== 'date') {
      withoutEnd += 1;
      continue;
    }
    if (end.ms < now || end.ms > horizon) continue;
    const days = Math.ceil((end.ms - now) / DAY_MS);
    expiring.push({ row, end, days });
  }
  expiring.sort((a, b) => a.end.ms - b.end.ms || String(a.row.uid).localeCompare(String(b.row.uid)));
  return { expiring, withoutEnd };
}

function daysLabel(days) {
  if (days === 0) return 'Ends today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

function ExpiringSoon({ rows, now, total }) {
  const { expiring, withoutEnd } = selectExpiring(rows, now);
  const partial = typeof total === 'number' && Number.isFinite(total) && rows.length !== total;
  return (
    <div data-testid="branch-contracts-expiring" className="mb-3">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Expiring soon</h3>
      <p className="text-[11px] text-gray-500 mt-0.5 dark:text-gray-400">
        Next 90 days. NDAs by valid_until, agreements by expires_at. The list has no
        renewal date separate from a partner deal&rsquo;s expiry. An end date already past,
        or further out than 90 days, is not in this strip.
      </p>
      {expiring.length === 0 ? (
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300" data-testid="branch-contracts-expiring-none">
          None in the next 90 days.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-800" data-testid="branch-contracts-expiring-rows">
          {expiring.map(({ row, end, days }) => (
            <li key={`${row.source || 'row'}:${row.uid}`} className="py-1.5 text-[12px]" data-testid="branch-contracts-expiring-row">
              <span className="font-semibold text-gray-900 dark:text-gray-100">{daysLabel(days)}</span>
              {' · '}
              {row.title || <Unrecorded reason="This row has no title on the list.">Not recorded</Unrecorded>}
              {' · '}
              <span className="font-mono">{end.day}</span>
              {' · '}
              <span className="font-mono">{end.field}</span>
            </li>
          ))}
        </ul>
      )}
      {withoutEnd > 0 ? (
        <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400" data-testid="branch-contracts-expiring-no-end">
          {withoutEnd === 1
            ? '1 row records no end date, so it is not expiring.'
            : `${withoutEnd} rows record no end date, so they are not expiring.`}
        </p>
      ) : null}
      {partial ? (
        <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400" data-testid="branch-contracts-expiring-partial">
          {`This strip reads ${rows.length} of ${total} rows.`}
        </p>
      ) : null}
    </div>
  );
}

function RenewalCell({ row }) {
  const end = endDateOf(row);
  if (end.kind === 'date') {
    return (
      <span>
        <span className="font-mono">{end.day}</span>
        {' '}
        <span className="font-mono text-gray-500 dark:text-gray-400">({end.field})</span>
      </span>
    );
  }
  if (end.reason === RENEWAL_UNRECORDED) {
    return <Unrecorded reason={RENEWAL_UNRECORDED}>Not recorded</Unrecorded>;
  }
  return <Unrecorded reason={end.reason}>Not recorded</Unrecorded>;
}

function finiteCount(n) {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export function BranchContractsLedger({ ledger, ledgerFailed, onRetry, stats, statsFailed, now = Date.now() }) {
  const total = finiteCount(ledger?.total);
  const rows = Array.isArray(ledger?.items) ? ledger.items : [];
  const sources = Array.isArray(ledger?.meta?.sources) ? ledger.meta.sources : null;
  const pending = finiteCount(stats?.pending_signature);

  return (
    <Card data-testid="branch-contracts-ledger">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Contracts in this database</h2>
      <p className="text-[11px] text-gray-500 mt-0.5 dark:text-gray-400">
        The four sources this deployment already lists. Nothing here sends, voids, or edits one.
      </p>

      <div className="mt-2" data-testid="branch-contracts-pending">
        {statsFailed ? (
          <Unreadable
            what="The signature counts"
            claim="A failed read is not zero pending signatures."
            onRetry={onRetry}
          />
        ) : stats === undefined ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading signature counts…</p>
        ) : pending === null ? (
          <Unrecorded reason="GET /api/admin/contracts/stats did not include pending_signature.">
            Not recorded
          </Unrecorded>
        ) : pending === 0 ? (
          <p>None pending signature. Sent and generated were read, and the count is zero.</p>
        ) : (
          <p>{pending} pending signature{pending === 1 ? '' : 's'} (sent or generated).</p>
        )}
      </div>

      <div className="mt-3">
        {ledger === undefined && !ledgerFailed ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading contracts…</p>
        ) : ledgerFailed ? (
          <Unreadable
            what="The contract list"
            claim="This is not a claim that this database holds no contracts."
            onRetry={onRetry}
          />
        ) : total === 0 ? (
          <>
            <ExpiringSoon rows={[]} now={now} total={total} />
            <p className="text-sm text-gray-700 dark:text-gray-300" data-testid="branch-contracts-empty">
              None in this database. The list was read{sources ? ` across ${sources.join(', ')}` : ''}.
            </p>
          </>
        ) : (
          <>
            <ExpiringSoon rows={rows} now={now} total={total} />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="text-[10px] font-extrabold uppercase tracking-[.08em] text-gray-500 dark:text-gray-400">
                    <th className="py-1.5 pr-3">Agreement</th>
                    <th className="py-1.5 pr-3">Counterparty</th>
                    <th className="py-1.5 pr-3">Status</th>
                    <th className="py-1.5 pr-3">Template</th>
                    <th className="py-1.5 pr-3">Version</th>
                    <th className="py-1.5 pr-3">Value</th>
                    <th className="py-1.5">Renewal</th>
                  </tr>
                </thead>
                <tbody data-testid="branch-contracts-rows">
                  {rows.map((r) => (
                    <tr key={`${r.source || 'row'}:${r.uid}`} className="border-t border-gray-100 align-top dark:border-gray-800">
                      <td className="py-1.5 pr-3">{r.title || <Unrecorded reason="This row has no title on the list.">Not recorded</Unrecorded>}</td>
                      <td className="py-1.5 pr-3">{r.recipient_email || <Unrecorded reason="This row has no counterparty on the list.">Not recorded</Unrecorded>}</td>
                      <td className="py-1.5 pr-3">{r.status || <Unrecorded reason="This row has no status on the list.">Not recorded</Unrecorded>}</td>
                      <td className="py-1.5 pr-3 font-mono">{r.template_name || <Unrecorded reason="This row names no template.">Not recorded</Unrecorded>}</td>
                      <td className="py-1.5 pr-3"><Unrecorded reason={VERSION_UNRECORDED}>Not recorded</Unrecorded></td>
                      <td className="py-1.5 pr-3"><Unrecorded reason={VALUE_UNRECORDED}>Not recorded</Unrecorded></td>
                      <td className="py-1.5"><RenewalCell row={r} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10.5px] text-gray-500 dark:text-gray-400" data-testid="branch-contracts-showing">
              {total === null
                ? `Showing ${rows.length}. The list did not include a total, so these rows are not all of them.`
                : `Showing ${rows.length} of ${total} in this database.`}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

function ageOf(iso) {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const days = Math.floor((Date.now() - at) / 86400000);
  if (days <= 0) return 'today';
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Current cards of the copy HQ pushed. Each links into the send flow.
 * Archived versions are not in this payload — the page renders the server's
 * `not_carried` reason for them and does not invent unusable cards.
 * The send page is not this file's: the link does not preselect a template.
 */
export function BranchTemplateCards({ items }) {
  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800" data-testid="branch-templates-list">
      {items.map((t) => (
        <li key={t.slug} className="py-2 flex items-start gap-3">
          <FileText size={14} className="mt-0.5 flex-shrink-0 text-gray-400" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-900 truncate dark:text-gray-100">{t.title}</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              <span className="font-mono">{t.slug}</span>
              {t.category ? ` · ${t.category}` : ''}
              {` · v${t.version}`}
            </div>
          </div>
          <Link
            to="/legal/send"
            data-testid="branch-template-use"
            data-template={t.slug}
            className="shrink-0 text-[11px] font-semibold text-gray-900 underline dark:text-gray-100"
          >
            Use template
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function BranchContracts({ user }) {
  const [data, setData] = useState(undefined); // undefined = loading
  const [failed, setFailed] = useState(false);
  const [ledger, setLedger] = useState(undefined);
  const [ledgerFailed, setLedgerFailed] = useState(false);
  const [stats, setStats] = useState(undefined);
  const [statsFailed, setStatsFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setData(await api.branchTemplates());
    } catch (e) {
      // THE FETCH FAILING AND THE TABLE BEING UNREADABLE ARE DIFFERENT THINGS.
      // This one is the network or the gate; the other arrives as a 200 with
      // `available: false` and its own reason.
      setFailed(true);
      setData(null);
      reportError('BranchContracts:load', e);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadLedger = useCallback(async () => {
    setLedgerFailed(false);
    setStatsFailed(false);
    try {
      setLedger(await api.adminListContracts({ limit: 500 }));
    } catch (e) {
      setLedgerFailed(true);
      setLedger(null);
      reportError('BranchContracts:ledger', e);
    }
    try {
      setStats(await api.adminContractStats());
    } catch (e) {
      setStatsFailed(true);
      setStats(null);
      reportError('BranchContracts:stats', e);
    }
  }, []);

  useEffect(() => { loadLedger(); }, [loadLedger]);

  const items = data?.items || [];
  const pushedAt = data?.pushed_at || null;
  const age = ageOf(pushedAt);

  // D151 — THE RAIL WAS TOLD NOTHING, so `WorkerRail` rendered "Not recorded"
  // and disabled its only button under "this page has not loaded a summary" —
  // on a page that had loaded HQ's library and its push stamp. Built per source
  // and filtered, so a failed read drops its line rather than printing a zero.
  //
  // NEVER-PUSHED IS A LINE, NOT A GAP. An empty library and a library HQ has
  // never sent are different facts (the reason `branch_templates_sync` exists
  // at all, D147), so the state the branch is in gets a sentence either way and
  // the rail can say which.
  const coverage = [
    items.length
      ? `${items.length} master template${items.length === 1 ? '' : 's'} in HQ's copy`
      : (data && data.available !== false && data.never_pushed_reason
        ? 'HQ has never pushed this branch a template library'
        : null),
    items.length && pushedAt ? `HQ last sent it ${age}` : null,
    // NO ARCHIVED COUNT, and the reason is on the payload rather than a
    // judgement made here: D147 dropped `is_active` from the push on its own
    // rule — HQ's library shows only active templates and its contract route
    // offers only the current version, so there is no archived-and-unusable
    // state for a branch to mirror and a column that could only hold 1 is the
    // D129 mistake. `not_carried` says exactly that, and the rail renders it
    // below rather than this line inventing a zero.
    finiteCount(ledger?.total) !== null
      ? `${ledger.total} contract${ledger.total === 1 ? '' : 's'} in this database`
      : null,
    !statsFailed && finiteCount(stats?.pending_signature) !== null
      ? (stats.pending_signature === 0
        ? 'No signature pending (sent or generated, read as zero)'
        : `${stats.pending_signature} pending signature${stats.pending_signature === 1 ? '' : 's'}`)
      : null,
  ].filter(Boolean);

  return (
    <BranchZone
      workspace="Contracts"
      user={user}
      stance="Read-only. HQ's library, and this database's contracts"
      coverage={coverage}
      coverageNote={coverage.length ? undefined
        : (failed
          ? 'The library read did not complete, so there is nothing to read back — this is not a claim that HQ has sent nothing.'
          : 'Loading HQ\'s template library…')}
      // FORWARDED FROM THE PAYLOAD, NOT TYPED HERE. `not_carried` is the
      // server's own list of what the push deliberately omits, each with its
      // reason, and the card below already renders it — so the rail reads the
      // same source rather than growing a second copy that can disagree with
      // it. The day the push carries a body, both shrink together.
      unavailable={(data?.not_carried || []).map((n) => [n.field, n.reason])}
    >
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Contracts</h1>
        <p className="text-sm text-gray-600 mt-1 dark:text-gray-400">
          Instantiate, never author. The master library is HQ&rsquo;s; this branch holds the copy HQ
          last sent it.
        </p>
      </header>

      <Card className="mb-4" data-testid="branch-templates">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Master template library</h2>
            <p className="text-[11px] text-gray-500 mt-0.5 dark:text-gray-400">
              Read-only. HQ publishes; this branch receives.
            </p>
          </div>
          {pushedAt && (
            <div className="text-[11px] text-gray-500 dark:text-gray-400" data-testid="branch-templates-asof">
              As of {String(pushedAt).slice(0, 10)}{age ? ` · ${age}` : ''}
            </div>
          )}
        </div>

        <div className="mt-3">
          {data === undefined ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>
          ) : failed ? (
            <Unreadable
              what="the template library"
              claim="This is not a claim that HQ has published nothing — the read itself did not complete."
              onRetry={load}
            />
          ) : data?.available === false ? (
            <Unreadable what="the template library" claim={data.reason} onRetry={load} />
          ) : !pushedAt ? (
            <Unrecorded reason={data?.never_pushed_reason}>Not pushed yet</Unrecorded>
          ) : items.length === 0 ? (
            // PUSHED AND EMPTY — a statement about HQ, which is why it is not
            // the same sentence as the one above it.
            <Unrecorded reason="HQ published its library and it held no templates. This is what HQ has, not a gap in the copy.">
              HQ&rsquo;s library is empty
            </Unrecorded>
          ) : (
            <BranchTemplateCards items={items} />
          )}
        </div>

        <p className="mt-3 text-[11px] text-gray-500 flex items-start gap-1.5 dark:text-gray-400">
          <Lock size={11} className="mt-0.5 flex-shrink-0" />
          <span>
            Changing a template is a Content submission, not an edit. The library is authored at HQ
            and reaches every branch on a publish, so a branch editing its own copy would put two
            versions of one agreement in front of two territories.
          </span>
        </p>
      </Card>

      {/* WHAT THE COPY DOES NOT CARRY, read off the payload rather than typed
          here — so the day HQ starts sending a field, this list shrinks by
          itself instead of going stale. */}
      {!!(data?.not_carried || []).length && (
        <Card className="mb-4" data-testid="branch-templates-not-carried">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">What the copy leaves at HQ</h2>
          <ul className="mt-2 space-y-2">
            {(data.not_carried || []).map((n) => (
              <li key={n.field}>
                <div className="text-xs font-medium text-gray-900 dark:text-gray-100">{n.field}</div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">{n.reason}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <BranchContractsLedger
        ledger={ledger}
        ledgerFailed={ledgerFailed}
        onRetry={loadLedger}
        stats={stats}
        statsFailed={statsFailed}
      />
    </BranchZone>
  );
}
