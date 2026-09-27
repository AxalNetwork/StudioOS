import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';

/**
 * WHICH FUND a Fund-bucket page operates (D371).
 *
 * `InvestorFundLPs` and `InvestorFundReporting` opened `items[0]` of
 * `api.fundsList()`. That list is every fund the caller can see — since D370,
 * the funds they are GP of record for AND the funds they hold an LP position
 * in — so the first row could be a fund they merely invest in, and every GP
 * control on it answered 404. The worker now marks each row `can_manage` with
 * the same test its fund gate runs, and this picks only among those.
 *
 * `?fund=<id>` chooses one; with no choice, the first operable fund. A fund the
 * caller cannot operate is never picked, even when named in the URL.
 *
 * THREE OUTCOMES, kept apart: the list could not be read (`error`, a retry is
 * the answer); the caller operates no fund (`funds` is empty, which is a fact
 * about them, not a failure); or a fund.
 */
export function pickManagedFund(items, wanted) {
  const funds = (Array.isArray(items) ? items : []).filter((f) => f && f.can_manage === true);
  const chosen = wanted != null && wanted !== ''
    ? funds.find((f) => String(f.id) === String(wanted))
    : null;
  return { funds, fund: chosen || funds[0] || null };
}

export function useManagedFund() {
  const [params, setParams] = useSearchParams();
  const wanted = params.get('fund');
  const [state, setState] = useState({ loading: true, error: null, items: null });

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await api.fundsList();
      const items = Array.isArray(res) ? res : res?.items;
      if (!Array.isArray(items)) throw new Error('The fund list came back in a shape this page cannot read.');
      setState({ loading: false, error: null, items });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'The fund list could not be read.', items: null });
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const { funds, fund } = pickManagedFund(state.items, wanted);
  const select = useCallback((id) => {
    const next = new URLSearchParams(params);
    next.set('fund', String(id));
    setParams(next, { replace: true });
  }, [params, setParams]);

  return { loading: state.loading, error: state.error, funds, fund, select, reload };
}

/** The fund switcher, drawn only when there is more than one fund to operate. */
export function FundPicker({ funds, fund, onSelect, testid = 'select-managed-fund' }) {
  if (!Array.isArray(funds) || funds.length < 2) return null;
  return (
    <label className="i6-fund-switcher">
      <span>Fund</span>
      <select data-testid={testid} value={fund ? String(fund.id) : ''} onChange={(e) => onSelect(e.target.value)}>
        {funds.map((f) => <option key={f.id} value={String(f.id)}>{f.name || `Fund #${f.id}`}</option>)}
      </select>
    </label>
  );
}
