import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { WorkerRail } from '../../ui';
import ZoneNav from '../../workspaces/ZoneNav';
import { bucketForPath } from '../../workspaces/shellConfig';
import { api } from '../../lib/api';
import './investorFundLanding.css';
import './investorFundLPs.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { investorZoneActions } from '../../workspaces/investorZoneActions';
import { investorZoneFilters } from '../../workspaces/investorZoneFilters';

const titleCase = (value) => String(value || 'Unrecorded').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const cents = (value) => value == null || value === '' ? null : Number(value);
const lpCommitment = (lp) => lp?.commitment_cents != null ? cents(lp.commitment_cents) / 100 : lp?.commitment_amount != null ? Number(lp.commitment_amount) : null;
const lpPaid = (lp) => lp?.paid_cents != null ? cents(lp.paid_cents) / 100 : lp?.invested_amount != null ? Number(lp.invested_amount) : null;
const money = (value) => value == null || !Number.isFinite(Number(value)) ? 'Unavailable' : `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const date = (value) => value ? String(value).slice(0, 10) : 'Unrecorded';

export default function InvestorFundLPs() {
  const [state, setState] = useState({ loading: true, fund: null, rows: null, error: null });
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', email: '', commitment: '' });
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState('');

  const load = useCallback(async () => {
    setState({ loading: true, fund: null, rows: null, error: null });
    try {
      const funds = await api.fundsList();
      const items = Array.isArray(funds) ? funds : funds?.items || [];
      if (!items.length) {
        setState({ loading: false, fund: null, rows: null, error: 'No accessible fund record is available in this environment.' });
        return;
      }
      const fund = items[0];
      const result = await api.fundsLpsList(fund.id);
      setState({ loading: false, fund, rows: result?.items || [], error: null });
    } catch (error) {
      setState({ loading: false, fund: null, rows: null, error: error?.message || 'The LP register is unavailable for this fund.' });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * ADD LP — the screen the registry's reason said was missing.
   *
   * `POST /api/funds/:id/lps` inserts a real `limited_partners` row and the
   * register below reads it straight back, so this is the whole of what was
   * absent. `requireFundGp` gates it: institutional tier AND the GP of record
   * for this fund. With no readable fund there is no id to post to, so the
   * control is disabled with that as its reason rather than posting into a 404.
   *
   * NO `user_id`. An LP is often an institution with no platform login, and the
   * commitment is recorded against a name and an email. Requiring an account
   * would make the register unable to describe most real funds; those two
   * columns are what the table carries for exactly this case.
   */
  const addLp = useMemo(() => {
    if (!state.fund?.id) {
      return {
        onClick: () => {},
        disabled: true,
        title: state.error
          ? 'No fund register is readable, so there is no fund to add an LP to.'
          : 'Waiting for a fund record.',
      };
    }
    return { onClick: () => { setAddError(''); setAdding(true); }, busy: saving };
  }, [state.fund, state.error, saving]);

  async function submitLp(event) {
    event.preventDefault();
    if (!state.fund?.id) return;
    const commitment = Number(draft.commitment);
    if (!draft.name.trim() && !draft.email.trim()) {
      setAddError('An LP needs a name or an email — without one the register cannot identify the row.');
      return;
    }
    if (!Number.isFinite(commitment) || commitment < 0) {
      setAddError('The commitment must be a number.');
      return;
    }
    setSaving(true); setAddError('');
    try {
      await api.fundsAddLpV2(state.fund.id, {
        name: draft.name.trim() || null,
        email: draft.email.trim() || null,
        commitment_amount: commitment,
        status: 'committed',
      });
      setDraft({ name: '', email: '', commitment: '' });
      setAdding(false);
      await load();
    } catch (cause) {
      setAddError(cause?.message || 'The LP could not be added.');
    } finally { setSaving(false); }
  }

  const rows = state.rows || [];
  const types = useMemo(() => [...new Set(rows.map((row) => row.type || row.entity_type).filter(Boolean))], [rows]);
  const visible = filter === 'all' ? rows : filter === 'behind' ? rows.filter((row) => {
    const commitment = lpCommitment(row);
    const paid = lpPaid(row);
    return commitment != null && paid != null && paid < commitment;
  }) : filter === 'kyc' ? rows.filter((row) => ['pending', 'in_review', 'unverified'].includes(String(row.kyc_status || row.kyc || '').toLowerCase())) : rows.filter((row) => (row.type || row.entity_type || '').toLowerCase() === filter);
  const totalCommitted = rows.reduce((sum, row) => sum + (lpCommitment(row) || 0), 0);
  const largest = rows.reduce((max, row) => Math.max(max, lpCommitment(row) || 0), 0);
  const kycOutstanding = rows.filter((row) => ['pending', 'in_review', 'unverified'].includes(String(row.kyc_status || row.kyc || '').toLowerCase())).length;

  return <div className="i6-fund ip1-fund-shell"><main className="i6-main ip1-fund-main" data-testid="investor-fund-lps"><header className="i6-header"><div><div className="i6-breadcrumb">Fund <span>‹</span> <b>LPs</b></div><h1>LP registry</h1><p>Registry, KYC state, documents and comms log.</p></div><button className="i6-refresh" type="button" onClick={load} disabled={state.loading} aria-label="Refresh LP register"><RefreshCw size={14} className={state.loading ? 'i6-spin' : ''} /></button></header>
    <ZoneNav bucket={bucketForPath('investor', '/funds')} role="investor" activeSlug="lps" className="my-3" />
    {/* The canvas's one row: `All LPs / Behind / KYC pending / By type` on the
        left, the ops on the right. Not one predicate moved — `visible` above
        still answers all four, and `By type` is still the same `types` memo,
        now declared as the dynamic group it always was so an account with no
        typed LP says so instead of showing three chips and nothing else. */}
    <ZoneToolbar
      role="investor"
      filters={investorZoneFilters('funds/lps', { value: filter, onChange: setFilter, dynamic: { types: types.map((type) => ({ key: type.toLowerCase(), label: titleCase(type) })) } })}
      actions={investorZoneActions('funds/lps', { handlers: { addLp }, view: { scope: state.fund?.name, header: ['LP', 'Type', 'Commitment', 'Paid to date', 'State', 'KYC'], rows: visible, cells: (lp) => [lp.name || lp.email, lp.lp_type || lp.type, lpCommitment(lp), lpPaid(lp), lp.status, lp.kyc_status || lp.kyc] } })}
      className="mb-3"
    />
    {adding && <form className="ip1-fund-add" onSubmit={submitLp} data-testid="form-add-lp">
      <div><label htmlFor="add-lp-name">LP name</label><input id="add-lp-name" data-testid="input-add-lp-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Institution or person" /></div>
      <div><label htmlFor="add-lp-email">Email</label><input id="add-lp-email" data-testid="input-add-lp-email" type="email" value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} placeholder="Optional if a name is given" /></div>
      <div><label htmlFor="add-lp-commitment">Commitment (USD)</label><input id="add-lp-commitment" data-testid="input-add-lp-commitment" type="number" min="0" step="any" value={draft.commitment} onChange={(e) => setDraft((d) => ({ ...d, commitment: e.target.value }))} required /></div>
      <div className="ip1-fund-add-actions">
        <button type="submit" data-testid="button-add-lp-save" disabled={saving}>{saving ? 'Adding…' : 'Add LP'}</button>
        <button type="button" data-testid="button-add-lp-cancel" onClick={() => { setAdding(false); setAddError(''); }}>Cancel</button>
      </div>
      {/* Said where the commitment is typed, because it is the figure a reader
          would otherwise assume is money received. `invested_amount` defaults
          to 0 and only a recorded payment moves it. */}
      <p className="ip1-fund-add-note" role={addError ? 'alert' : undefined} data-testid={addError ? 'status-add-lp-error' : 'note-add-lp'}>
        {addError || 'A commitment is what the LP has agreed to, not what they have paid. Paid-to-date stays at zero until a payment is recorded.'}
      </p>
    </form>}
    {state.error && <div className="i6-load-error ip1-fund-unavailable" data-testid="status-fund-lps-unavailable"><AlertCircle size={14} /> <span>LP registry unavailable. No LP count, commitment, payment, KYC, or delinquency claim is being made. <small>{state.error}</small></span></div>}
    <section className="i6-summary ip1-fund-summary"><div><div className="i6-kicker">{state.fund?.name || 'Fund record unavailable'}</div><strong className="i6-money">{state.error ? 'Unavailable' : money(totalCommitted)}</strong><span className="i6-caption">committed</span></div><dl className="i6-summary-stats"><div><dt>LPs</dt><dd>{state.error ? 'Unavailable' : rows.length}</dd></div><div><dt>Largest position</dt><dd>{state.error ? 'Unavailable' : money(largest)}</dd></div><div><dt>KYC outstanding</dt><dd>{state.error ? 'Unavailable' : kycOutstanding}</dd></div></dl><p>Figures appear only when a fund record and its authorized LP register are available. Share of fund is computed from returned commitment rows.</p></section>
    <section className="i6-card i6-registry ip1-fund-registry"><header><div><h2>LP register</h2><span>{state.error ? 'Register source unavailable' : `${visible.length} of ${rows.length} records`}</span></div><span>Read-only collection</span></header>{state.loading ? <div className="i6-skeleton" /> : state.error ? <div className="i6-empty"><AlertCircle size={16} /> The detailed LP register cannot be displayed without an accessible fund source.</div> : rows.length === 0 ? <div className="i6-empty">No LP records are available for this fund.</div> : visible.length === 0 ? <div className="i6-empty">No LP records match this filter.</div> : <div className="ip1-fund-table-wrap"><table><thead><tr><th>LP</th><th>Type</th><th>Commitment</th><th>Share</th><th>Paid to date</th><th>State</th><th>KYC</th></tr></thead><tbody>{visible.map((lp) => { const commitment = lpCommitment(lp); const paid = lpPaid(lp); const status = lp.status || (commitment != null && paid != null && paid >= commitment ? 'Paid' : 'Unrecorded'); const kyc = lp.kyc_status || lp.kyc || 'Unrecorded'; return <tr key={lp.id || lp.uid || lp.email}><td><strong>{lp.name || lp.email || `LP #${lp.id}`}</strong><small>{lp.joined_at ? `Joined ${date(lp.joined_at)}` : 'Name source preserved'}</small></td><td>{lp.type || lp.entity_type || 'Unrecorded'}</td><td>{money(commitment)}</td><td>{commitment && totalCommitted ? `${((commitment / totalCommitted) * 100).toFixed(1)}%` : 'Unavailable'}</td><td>{money(paid)}</td><td><span className={`ip1-fund-pill ${String(status).toLowerCase()}`}>{titleCase(status)}</span></td><td><span className={`ip1-fund-pill ${String(kyc).toLowerCase()}`}>{titleCase(kyc)}</span></td></tr>; })}</tbody></table></div>}<p className="i6-footnote">This collection does not add LPs, export the register, send communications, or change KYC/LPA records.</p></section>
    <footer className="i6-footnote ip1-fund-boundary">Fund source-preserved · no write actions from this page.</footer>
  </main><WorkerRail
    workspace="Fund"
    role="investor"
    className="i6-rail"
    stance={"Read-only LP register"}
    note={"The register is kept tied to its source rows. Nothing on this page adds an LP, exports the register, sends a communication, or changes a KYC/LPA record."}
    coverage={[
        state.error ? 'LP register unavailable' : `${rows.length} LP record${rows.length === 1 ? '' : 's'} readable`,
      ]}
    coverageNote={'Only an authorized fund register can support commitment, paid-to-date, share or KYC figures.'}
    unavailable={[
        ['Missing fund and KYC fields', 'They stay unavailable. No letter, call or record is generated to fill one in.'],
      ]}
  /></div>;
}