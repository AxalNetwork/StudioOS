import { useCallback, useEffect, useRef, useState } from 'react';
import { fundReportsApi } from '../lib/api/fundReports.js';
import { useActiveCompany } from '../contexts/ActiveCompanyContext';

export const emptyNarrative = () => ({ letter: [], developments: [], outlook: [], subsequent: [] });
export function readableFund(value) {
  const money = (n) => n === null || (Number.isSafeInteger(n) && n >= 0);
  const strings = (record, keys) => record && !Array.isArray(record) && keys.every(k => record[k] === null || typeof record[k] === 'string');
  return value?.currency === 'USD' && typeof value.can_manage === 'boolean'
    && Number.isSafeInteger(value.fund?.id) && value.fund.id > 0
    && typeof value.fund.name === 'string' && value.fund.name.trim()
    && Number.isSafeInteger(value.fund.lp_count) && value.fund.lp_count >= 0
    && money(value.fund.size_cents) && money(value.totals?.committed_cents) && money(value.totals?.invested_cents)
    && strings(value.fund.gp, ['name', 'title', 'entity', 'email'])
    && strings(value.fund.providers, ['fund_admin', 'auditor', 'legal_counsel', 'custodian', 'valuation_policy']) && Array.isArray(value.periods)
    && value.periods.every(p => Number.isSafeInteger(p?.id) && p.id > 0 && typeof p.period === 'string' && ['draft', 'issued'].includes(p.status) && (value.can_manage || p.status === 'issued'))
    && (value.lpa === null || (typeof value.lpa === 'object' && !Array.isArray(value.lpa)));
}
export function readablePeriod(value) {
  const n = value?.narrative;
  return value && typeof value.period === 'string' && ['draft', 'issued'].includes(value.status)
    && (value.period_start === null || typeof value.period_start === 'string') && (value.period_end === null || typeof value.period_end === 'string')
    && n && ['letter', 'outlook'].every(k => Array.isArray(n[k]) && n[k].every(p => typeof p === 'string'))
    && Array.isArray(n.developments) && n.developments.every(e => e && ['date', 'title', 'body'].every(k => typeof e[k] === 'string'))
    && Array.isArray(n.subsequent) && n.subsequent.every(e => e && ['d', 'e'].every(k => typeof e[k] === 'string'));
}
export function useFundReport(fundId, periodId, corrects) {
  const { company } = useActiveCompany();
  const companyId = company?.id;
  const scope = JSON.stringify([fundId, periodId, corrects, companyId]);
  const [state, setState] = useState({ loading: true, data: null, error: null, scope });
  const attempt = useRef(0);
  const reload = useCallback(async () => {
    const own = ++attempt.current;
    setState({ loading: true, data: null, error: null, scope });
    try {
      const page = await fundReportsApi.fund(fundId);
      if (!readableFund(page)) throw new Error('Unreadable fund record.');
      let period = null;
      if (periodId === 'new') {
        if (!page.can_manage) throw Object.assign(new Error('This fund report cannot be edited.'), { status: 403 });
        period = { period: '', period_start: '', period_end: '', status: 'draft', narrative: emptyNarrative(), corrects_period_id: null };
        if (corrects) {
          const original = (await fundReportsApi.period(fundId, corrects)).period;
          if (!readablePeriod(original) || original.status !== 'issued') throw new Error('Unreadable original report.');
          period = { ...period, period: `${original.period.slice(0, 89)} correction`, period_start: original.period_start, period_end: original.period_end,
            narrative: original.narrative, corrects_period_id: original.id, corrects_period: original.period };
        }
      } else if (periodId) {
        const response = await fundReportsApi.period(fundId, periodId);
        period = response.period;
        if (!readablePeriod(period) || (!page.can_manage && period.status !== 'issued')) throw new Error('Unreadable reporting period.');
      }
      if (own === attempt.current) setState({ loading: false, error: null, data: { ...page, period }, scope });
    } catch (error) {
      if (own === attempt.current) setState({ loading: false, data: null, error, scope });
    }
  }, [fundId, periodId, corrects, companyId, scope]);
  useEffect(() => { reload(); return () => { attempt.current += 1; }; }, [reload]);
  return state.scope === scope ? { ...state, reload } : { loading: true, data: null, error: null, reload };
}
