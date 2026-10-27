import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminSubAccountsApi } from '../../../lib/api/adminSubAccounts.js';
import { reportError } from '../../../lib/log';
import { lpLine, testerLine, day } from './accountDrawerModel';

/**
 * D1306 (#3403, ACC5) — the drawer's Sub-accounts tab: the account's Product
 * tester record and its LP status, from D1302's `GET
 * /api/admin/sub-accounts/accounts/:userId`.
 *
 * READS ONLY, AS D1302 §6 SAYS. A tester is decided in Approvals › Product
 * testers (D1042) and an LP on the LP applications page; this tab links there
 * and draws no second set of buttons. Each card reads or fails on its own, and
 * a failed read is said with Try again, never drawn as "none".
 */
export default function AccountSubAccounts({ userId }) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const load = useCallback(async () => {
    setState({ status: 'loading', data: null });
    try {
      const data = await adminSubAccountsApi.account(userId);
      setState({ status: 'ok', data });
    } catch (e) {
      reportError('AccountSubAccounts:load', e);
      setState({ status: e?.status === 403 ? 'refused' : 'failed', data: null });
    }
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  if (state.status === 'loading') return <div className="text-sm text-gray-500" data-testid="sub-accounts-loading">Reading sub-accounts…</div>;
  if (state.status === 'refused') {
    return <p className="text-sm text-gray-600 dark:text-gray-400" data-testid="sub-accounts-refused">Only a Super Admin can open another administrator’s record.</p>;
  }
  if (state.status === 'failed') {
    return (
      <div className="text-sm text-gray-600 dark:text-gray-400" data-testid="sub-accounts-failed">
        The sub-accounts could not be read. That is not the same as none.{' '}
        <button type="button" onClick={load} className="font-semibold text-violet-700 underline dark:text-violet-300">Try again</button>
      </div>
    );
  }

  const tester = testerLine(state.data?.tester);
  const record = state.data?.tester?.record || null;
  return (
    <div className="space-y-3" data-testid="sub-accounts">
      <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-800" data-testid="sub-accounts-tester">
        <h4 className="text-[13.5px] font-extrabold text-gray-900 dark:text-gray-100">Product tester</h4>
        <p className="mt-1 text-[12.5px] text-gray-700 dark:text-gray-300" data-testid="sub-accounts-tester-line">{tester.text}</p>
        {tester.reason && <p className="mt-1 text-[12px] text-gray-500">Reason they were shown: “{tester.reason}”</p>}
        {record?.availability && <p className="mt-1 text-[12px] text-gray-500">Availability: {record.availability}</p>}
        {record && (
          <p className="mt-1 text-[12px] text-gray-500">
            Email consent: {record.consent_email_at ? `given on ${day(record.consent_email_at) || 'a date not recorded'}` : 'not given'}
            {record.consent_version ? ` · version ${record.consent_version}` : ''}
          </p>
        )}
        <Link to={tester.kind === 'applied' ? '/admin/approvals/product-testers' : '/admin/approvals/product-testers/active'}
          className="mt-2 inline-block text-[12.5px] font-semibold text-violet-700 hover:underline dark:text-violet-300">
          {tester.kind === 'applied' ? 'Decide in Approvals' : 'Open Product testers'}
        </Link>
      </section>
      <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-800" data-testid="sub-accounts-lp">
        <h4 className="text-[13.5px] font-extrabold text-gray-900 dark:text-gray-100">LP</h4>
        <p className="mt-1 text-[12.5px] text-gray-700 dark:text-gray-300" data-testid="sub-accounts-lp-line">{lpLine(state.data?.lp)}</p>
        <Link to="/admin/lp-applications" className="mt-2 inline-block text-[12.5px] font-semibold text-violet-700 hover:underline dark:text-violet-300">
          Open LP applications
        </Link>
      </section>
    </div>
  );
}
