import React, { useCallback, useEffect, useState } from 'react';
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
 * real — `publishTemplate` (D147) gives a branch its copy — and the other two
 * are not, for the same reason: `licence_contracts` (migration 259) is **HQ's**
 * table, read by `admin_licences.ts` behind `requireSuperAdmin`, which on a
 * branch answers "HQ only" (D106). A branch has no contracts read of its own.
 * So this page ships the library and NAMES the absence rather than drawing an
 * empty ledger under a heading that implies rows are coming.
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

function ageOf(iso) {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const days = Math.floor((Date.now() - at) / 86400000);
  if (days <= 0) return 'today';
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export default function BranchContracts() {
  const [data, setData] = useState(undefined); // undefined = loading
  const [failed, setFailed] = useState(false);

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

  const items = data?.items || [];
  const pushedAt = data?.pushed_at || null;
  const age = ageOf(pushedAt);

  return (
    <BranchZone workspace="Contracts">
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
                </li>
              ))}
            </ul>
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

      <Card data-testid="branch-contracts-ledger">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Active contracts</h2>
        <div className="mt-2">
          <Unrecorded reason="A licence's contracts live in HQ's `licence_contracts` ledger, and every route over it is super-admin-only — which on a branch answers 'HQ only'. There is no branch-side read of this branch's own contracts yet, so a table here would be an empty ledger rather than a short one.">
            No branch-side contract read
          </Unrecorded>
        </div>
      </Card>
    </BranchZone>
  );
}
