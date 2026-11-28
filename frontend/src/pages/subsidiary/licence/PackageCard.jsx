import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { licencePackageMineApi } from '../../../lib/api/licencePackageMine';
import { programName } from '../../../lib/licenceLegalReadiness';
import { longDate, tabPath } from '../../../lib/licencePage';
import { formatMinorOrCount } from '../../../lib/money.js';
import { reportError } from '../../../lib/log';
import { Unrecorded, Unreadable } from '../../../ui';

/**
 * D5026 part 2 (#5026) — "Your Axal VC package", board L35 of the Licences and Contracts v2 Addendum canvas: the
 * package HQ accepted for this studio's licence, read only, on the studio's own Licence page.
 *
 * One read, `GET /api/licence/mine/package` (`routes/licence_package_mine.ts`). It carries the package and
 * version, the frozen programs, the term and its state, the accepted annual price and the programs granted on
 * their own. It never carries HQ's recommendation, override or country model, so none is drawn.
 *
 * NO PACKAGE IS NOT NO PROGRAMS (#5026, Empty states). With no accepted term the card says "No Axal VC package
 * recorded" and names the standalone grants, or says none is granted on its own and points at Programs. A
 * ledger or branch that holds no package record says Not recorded with the server's reason; a failed read says
 * Unavailable with Try again. Nothing here is a zero.
 */

const card = 'rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900';
const label = 'text-[10px] font-extrabold uppercase tracking-widest text-gray-500 dark:text-gray-400';

const STATE_WORD = {
  scheduled: 'Starts later',
  active: 'Active',
  renewal_pending: 'Active · HQ is preparing the next term',
  superseded: 'Superseded',
  ended: 'Ended',
};

const programList = (keys) => (Array.isArray(keys) && keys.length ? keys.map(programName).join(', ') : null);
const price = (term) => (term.annual_fee_cents == null ? null : formatMinorOrCount(term.annual_fee_cents, term.currency));

/**
 * The card's model from the read: `{ kind: 'loading' | 'unreadable' | 'none_linked' | 'not_recorded' | 'none' | 'package', … }`.
 * `read` is `{ value, error }`: `value` undefined while loading, `error` set when the read failed.
 */
export function packageCardModel(read) {
  if (read.error) return read.error.status === 404 ? { kind: 'none_linked' } : { kind: 'unreadable' };
  const v = read.value;
  if (v === undefined) return { kind: 'loading' };
  if (!v || v.recorded === false || v.source === 'copy') {
    return { kind: 'not_recorded', reason: v?.reason || 'This deployment holds no record of an Axal VC package.' };
  }
  const standalone = Array.isArray(v.standalone) ? v.standalone : null;
  if (!v.current) {
    return {
      kind: 'none',
      standalone: programList(standalone),
      line: standalone && standalone.length
        ? `Programs on this licence are standalone grants: ${programList(standalone)}. No package does not mean no programs.`
        : 'HQ has not granted any program on its own either. No package does not mean no programs: Programs shows what HQ grants this studio.',
    };
  }
  const c = v.current;
  const rows = [
    ['Package', `${c.package_name} · v${c.package_version}`],
    ['Included programs', programList(c.programs)],
    ['Standalone extras', standalone === null ? null : programList(standalone) || 'None'],
    ['Annual price', price(c)],
    ['Effective', `${longDate(c.starts_on)} – ${longDate(c.ends_on)}`],
    ['Status', STATE_WORD[c.state] || null],
    ['Next term', v.next ? `${v.next.package_name} · v${v.next.package_version} from ${longDate(v.next.starts_on)}` : `None accepted yet · this term ends ${longDate(c.ends_on)}`],
  ];
  return { kind: 'package', rows };
}

/** `api` is the read; tests pass their own. */
export default function PackageCard({ api = licencePackageMineApi }) {
  const [read, setRead] = useState({ value: undefined, error: null });
  const load = useCallback(() => {
    let alive = true;
    setRead({ value: undefined, error: null });
    api.mine().then(
      (value) => { if (alive) setRead({ value, error: null }); },
      (error) => {
        if (error?.status !== 404) reportError('MyLicencePage:package', error);
        if (alive) setRead({ value: null, error: error || new Error('unreadable') });
      },
    );
    return () => { alive = false; };
  }, [api]);
  useEffect(() => load(), [load]);
  const m = packageCardModel(read);
  if (m.kind === 'none_linked') return null;
  return (
    <section className={`${card} overflow-hidden`} data-testid="licence-package-card" data-kind={m.kind} aria-labelledby="licence-package-title">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <h2 id="licence-package-title" className="text-sm font-extrabold tracking-tight text-gray-900 dark:text-gray-100">Your Axal VC package</h2>
        <span className={label}>Read-only</span>
      </div>
      <div className="border-t border-gray-100 px-4 py-3 dark:border-gray-800">
        {m.kind === 'loading' && (
          <div className="space-y-2" aria-hidden="true" data-testid="licence-package-loading">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />)}
          </div>
        )}
        {m.kind === 'unreadable' && (
          <Unreadable what="Your Axal VC package" claim="This is not the same as no package." onRetry={load} />
        )}
        {m.kind === 'not_recorded' && (
          <p className="text-xs text-gray-600 dark:text-gray-300"><Unrecorded reason={m.reason} reasonVisible /></p>
        )}
        {m.kind === 'none' && (
          <div data-testid="licence-package-none">
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100">No Axal VC package recorded</p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{m.line}</p>
            <Link to={tabPath('programs')} className="mt-2 inline-flex min-h-[44px] items-center text-xs font-bold text-slate-700 underline-offset-2 hover:underline dark:text-slate-300">Open Programs ›</Link>
          </div>
        )}
        {m.kind === 'package' && (
          <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2" data-testid="licence-package-rows">
            {m.rows.map(([k, val]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-gray-50 py-1.5 text-xs dark:border-gray-800/60">
                <dt className="text-gray-500 dark:text-gray-400">{k}</dt>
                <dd className="text-right text-gray-900 dark:text-gray-100">{val ?? <Unrecorded />}</dd>
              </div>
            ))}
          </dl>
        )}
        {m.kind === 'package' && (
          <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">HQ accepted this package for your licence. Each program still needs its agreement before it is in force; the Contract tab shows them. No HQ pricing model is shown here.</p>
        )}
      </div>
    </section>
  );
}
