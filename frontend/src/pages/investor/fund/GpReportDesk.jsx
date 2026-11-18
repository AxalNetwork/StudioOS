import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../../../lib/api';
import { lastClosedQuarter } from '../../../lib/quarterlyReportViewModel';
import { fundReportingApi } from '../../../lib/api/fundReporting.js';
import { CARD, MONO, Chip, SectionLabel } from './FundWorkspaceSupport';
import { Loader2, FileDown } from 'lucide-react';

export default function GpReportDesk() {
  const [funds, setFunds] = useState([]);
  const [fundId, setFundId] = useState('');
  const [lps, setLps] = useState([]);
  const [lpId, setLpId] = useState('');
  const [periods, setPeriods] = useState([]);
  const [periodKey, setPeriodKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    let live = true;
    api.fundsList()
      .then((r) => { if (live) setFunds(r?.items || []); })
      .catch((e) => { if (live) setErr(e?.message || 'Could not load funds.'); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!fundId) { setLps([]); setPeriods([]); return undefined; }
    let live = true;
    setErr('');
    Promise.all([
      api.fundsLpsList(fundId).catch(() => ({ items: [] })),
      api.fundsReportPeriods(fundId).catch(() => ({ items: [] })),
    ]).then(([l, p]) => {
      if (!live) return;
      setLps(l?.items || []);
      setPeriods(p?.items || []);
      setLpId('');
    });
    return () => { live = false; };
  }, [fundId]);

  // The last four closed quarters, plus any period the fund already has a row
  // for. A GP can always produce a statement for a quarter that has ended; only
  // an issued row carries a letter.
  const periodOptions = useMemo(() => {
    const out = [];
    let cursor = new Date();
    for (let i = 0; i < 4; i++) {
      const q = lastClosedQuarter(cursor);
      const row = periods.find((p) => p.period === q.label);
      out.push({ ...q, key: q.label, status: row?.status || 'none', row });
      cursor = new Date(`${q.start}T12:00:00`);
    }
    return out;
  }, [periods]);

  const selected = periodOptions.find((p) => p.key === periodKey) || periodOptions[0];

  const generate = async () => {
    if (!fundId || !lpId || !selected) return;
    setBusy(true); setErr(''); setNote('');
    try {
      const payload = await api.fundsLpReport(fundId, lpId);
      const { exportQuarterlyReportPdf } = await import('../lib/quarterlyReportPdf');
      const issued = selected.status === 'issued';
      // D712: an issued period prints its recorded issue date and, when the
      // reporting queue issued it, the LP's frozen statement and the period's
      // frozen fund figures. Before issue, a live draft opens through the
      // queue's audited read, so the read is recorded.
      let statement = null;
      let figures = null;
      if (issued) {
        statement = (payload?.capital_statements || []).find((st) => Number(st.report_period_id) === Number(selected.row?.id))?.figures || null;
        const snap = selected.row?.snapshot;
        if (snap && snap.schema === 'lp_quarterly_report/1') {
          const { statements: _statements, ...fundFigures } = snap;
          figures = fundFigures;
        }
      } else {
        const draft = (payload?.statement_drafts || []).find((d) => d.period_label === selected.label);
        if (draft) statement = (await fundReportingApi.read(draft.uid))?.figures || null;
      }
      const issuedStamp = issued ? new Date(selected.row?.issued_at) : null;
      const out = await exportQuarterlyReportPdf({
        payload,
        fundId: Number(fundId),
        period: { ...selected, label: selected.label },
        issuedAt: issuedStamp && !Number.isNaN(issuedStamp.getTime()) ? issuedStamp : new Date(),
        narrative: selected.row?.narrative || null,
        issued,
        statement,
        figures,
      });
      setNote(`${out.filename} · ${out.pages} pages${out.draft ? ' · marked DRAFT' : ''}`);
    } catch (e) {
      setErr(e?.message || 'Could not generate that statement.');
    } finally {
      setBusy(false);
    }
  };

  const SELECT = 'rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 '
    + 'px-2.5 py-2 text-xs text-gray-700 dark:text-gray-300';

  return (
    <div>
      <SectionLabel right={<Chip tone="violet">GP only</Chip>}>
        Generate an LP statement
      </SectionLabel>
      <div className={`${CARD} p-5`} data-testid="gp-report-desk">
        <p className="text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400">
          Produces a named limited partner&apos;s quarterly report from their own commitment, capital calls and
          distributions, over the fund model this workspace shows. The document is stamped
          <strong className="text-gray-700 dark:text-gray-300"> DRAFT</strong> until the period is issued and
          carries a General Partner letter.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-4">
          <select value={fundId} onChange={(e) => setFundId(e.target.value)} className={SELECT} aria-label="Fund">
            <option value="">Select fund…</option>
            {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <select value={lpId} onChange={(e) => setLpId(e.target.value)} className={SELECT} aria-label="Limited partner" disabled={!lps.length}>
            <option value="">{lps.length ? 'Select LP…' : 'No LPs on this fund'}</option>
            {lps.map((l) => (
              <option key={l.id} value={l.id}>{l.name || l.email || `LP #${l.id}`}</option>
            ))}
          </select>
          <select value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} className={SELECT} aria-label="Period">
            {periodOptions.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}{p.status === 'issued' ? ' · issued' : p.status === 'draft' ? ' · draft' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={generate}
            disabled={busy || !fundId || !lpId}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <FileDown size={13} aria-hidden="true" />}
            {busy ? 'Building…' : 'Generate'}
          </button>
        </div>
        {note && <p className="mt-3 text-[11.5px] text-green-700 dark:text-green-400">{note}</p>}
        {err && <p className="mt-3 text-[11.5px] text-red-600 dark:text-red-400">{err}</p>}
        <p className="mt-3 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
          The signature block, the administrator, auditor, counsel and custody lines come from the fund record
          (<span className={MONO}>vc_funds</span>). Anything unset prints as &ldquo;not recorded&rdquo; rather than a
          name — set them with <span className={MONO}>PATCH /api/funds/:id</span>. Writing the period letter and
          issuing a period is <span className={MONO}>POST /api/funds/:id/report-periods</span>; no editor for it
          ships in this change.
        </p>
      </div>
    </div>
  );
}
